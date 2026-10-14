const STATE_KEY = 'morning-todos:v1';
const PASS_KEY = 'morning-todos:passphrase';
const DAY = 864e5;
const $ = (selector) => document.querySelector(selector);

let data = null;
let encrypted = false;
let state = loadState();
let pendingSelection = null;
let selectionClearedAt = 0;

// ---------- persistence ----------

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STATE_KEY));
  } catch {}
  return {
    items: raw?.items ?? {},   // id -> { done, ranges: [{ start, end, text, kind, splitId }], seenAt }
    splits: raw?.splits ?? [], // todos you split off: { id, parentId, section, text, links, createdAt }
    prev: raw?.prev ?? null,   // the previous morning's ids, to spot what got resolved overnight
    cleared: raw?.cleared ?? null,
    hideDone: Boolean(raw?.hideDone),
  };
}

const save = () => localStorage.setItem(STATE_KEY, JSON.stringify(state));
const itemState = (id) => (state.items[id] ??= { done: false, ranges: [] });
const firstLine = (text) => String(text).split('\n')[0];

// ---------- loading + decryption ----------

async function getJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

async function decrypt(payload, passphrase) {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bytes(payload.salt), iterations: payload.iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv) }, key, bytes(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function boot() {
  const sealed = await getJson('data/todos.enc.json').catch(() => null);
  if (sealed) {
    encrypted = true;
    const saved = localStorage.getItem(PASS_KEY) || sessionStorage.getItem(PASS_KEY);
    if (saved) {
      try {
        data = await decrypt(sealed, saved);
      } catch {
        forgetPassphrase();
      }
    }
    if (!data) return showUnlock(sealed);
  } else {
    data = await getJson('data/preview.json').catch(() => null);
    if (!data) {
      $('#list').innerHTML = '<p class="empty">No todos yet. The first morning run will fill this in.</p>';
      return;
    }
  }
  start();
}

function showUnlock(sealed) {
  const form = $('#unlock');
  form.hidden = false;
  $('#passphrase').focus();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const passphrase = $('#passphrase').value;
    $('#unlock-btn').disabled = true;
    $('#unlock-error').textContent = '';
    try {
      data = await decrypt(sealed, passphrase);
      ($('#remember').checked ? localStorage : sessionStorage).setItem(PASS_KEY, passphrase);
      form.hidden = true;
      start();
    } catch {
      $('#unlock-error').textContent = "That passphrase didn't work.";
    } finally {
      $('#unlock-btn').disabled = false;
    }
  };
}

function forgetPassphrase() {
  localStorage.removeItem(PASS_KEY);
  sessionStorage.removeItem(PASS_KEY);
}

// ---------- reconcile today's data with your saved ticks ----------

function reconcile() {
  const now = Date.now();
  const ids = new Set(data.items.map((item) => item.id));

  if (state.prev && state.prev.generatedAt !== data.generatedAt) {
    const gone = Object.entries(state.prev.items)
      .filter(([id]) => !ids.has(id) && !state.items[id]?.done)
      .map(([id, text]) => ({ id, text }));
    state.cleared = { generatedAt: data.generatedAt, items: gone };
  }
  state.prev = { generatedAt: data.generatedAt, items: Object.fromEntries(data.items.map((i) => [i.id, firstLine(i.text)])) };

  for (const item of data.items) itemState(item.id).seenAt = now;
  for (const [id, s] of Object.entries(state.items)) {
    if (!id.startsWith('split:') && now - (s.seenAt || 0) > 14 * DAY) delete state.items[id];
  }
  save();
}

// ---------- rendering ----------

const pacific = (date, options) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...options }).format(date);

function ago(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso)) / DAY);
  if (days < 1) return 'today';
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('data-') || key.startsWith('aria-') || ['href', 'target', 'rel', 'title', 'type', 'role'].includes(key)) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

// Saved ranges are re-anchored by their text, so they survive small wording changes overnight.
function resolveRanges(text, ranges) {
  return ranges
    .map((r) => {
      if (text.slice(r.start, r.end) === r.text) return r;
      const at = text.indexOf(r.text);
      return at < 0 ? null : { ...r, start: at, end: at + r.text.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function renderText(item) {
  const text = item.text;
  const node = el('div', { class: 'todo-text', 'data-id': item.id });
  // The first line is the todo itself; anything after it is supporting detail.
  const lead = el('span', { class: 'lead' });
  const rest = el('span', { class: 'rest' });
  const cut = text.includes('\n') ? text.indexOf('\n') : text.length;
  const emit = (from, to, r) => {
    for (const [a, b, target] of [[from, Math.min(to, cut), lead], [Math.max(from, cut), to, rest]]) {
      if (a >= b) continue;
      const chunk = text.slice(a, b);
      target.append(r
        ? el('span', {
            class: `part part-${r.kind}`,
            'data-start': String(r.start),
            'data-split': r.splitId,
            title: r.kind === 'done' ? 'Ticked off. Click to undo' : 'Split into its own todo. Click to jump to it',
          }, chunk)
        : chunk);
    }
  };
  let pos = 0;
  for (const r of resolveRanges(text, itemState(item.id).ranges)) {
    if (r.start < pos) continue;
    if (r.start > pos) emit(pos, r.start);
    emit(r.start, r.end, r);
    pos = r.end;
  }
  emit(pos, text.length);
  node.append(lead, rest);
  return node;
}

function tagClass(tag) {
  if (/fail|breach|SLA|urgent/i.test(tag)) return 'chip bad';
  if (/conflict|due|untouched/i.test(tag)) return 'chip warn';
  return 'chip';
}

function renderTodo(item) {
  const s = itemState(item.id);
  const isSplit = item.id.startsWith('split:');
  const meta = el('div', { class: 'meta' },
    ...(item.links || []).map((link) => el('a', { class: 'chip', href: link.url, target: '_blank', rel: 'noopener' }, link.label)),
    ...(item.tags || []).map((tag) => el('span', { class: tagClass(tag) }, tag)),
    item.since ? el('span', {}, ago(item.since)) : null,
    isSplit ? el('span', {}, `from “${item.parentText}”`) : null,
    isSplit ? el('button', { class: 'remove', title: 'Remove this split', 'aria-label': 'Remove this split', 'data-remove': item.id }, '×') : null,
  );
  return el('li', { class: `todo${s.done ? ' done' : ''}${isSplit ? ' split' : ''}`, 'data-id': item.id },
    el('button', { class: 'check', role: 'checkbox', 'aria-checked': String(s.done), 'aria-label': `Done: ${firstLine(item.text)}`, 'data-check': item.id }, '✓'),
    el('div', { class: 'body' }, renderText(item), meta),
  );
}

function render() {
  const list = $('#list');
  list.replaceChildren();
  $('#controls').hidden = false;
  $('#hint').hidden = false;
  $('#lock').hidden = !encrypted;
  $('#hide-done').checked = state.hideDone;

  const generated = new Date(data.generatedAt);
  $('#today').textContent = pacific(new Date(), { weekday: 'long', month: 'short', day: 'numeric' });
  $('#refreshed').textContent = `Refreshed ${pacific(generated, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} PT${encrypted ? '' : ' · local preview'}`;

  const notices = $('#notices');
  notices.replaceChildren();
  if (Date.now() - generated > 26 * 36e5) {
    notices.append(el('div', { class: 'notice bad' }, "This list is more than a day old. This morning's refresh may have failed. Check the repo's Actions tab."));
  }
  const failing = Object.entries(data.sources || {}).filter(([, s]) => !s.ok);
  if (failing.length) {
    notices.append(el('div', { class: 'notice' }, failing.map(([name, s]) => `${name}: ${s.skipped ? 'not set up yet' : `couldn't load (${s.error})`}`).join(' · ')));
  }

  const byId = new Map(data.items.map((item) => [item.id, item]));
  const splitsByParent = new Map();
  const orphans = [];
  for (const split of state.splits) {
    if (byId.has(split.parentId)) {
      if (!splitsByParent.has(split.parentId)) splitsByParent.set(split.parentId, []);
      splitsByParent.get(split.parentId).push(split);
    } else orphans.push(split);
  }

  const sections = [...data.sections, { id: 'orphans', title: 'Split-off todos' }];
  let total = 0;
  let done = 0;
  for (const section of sections) {
    const rows = [];
    const members = section.id === 'orphans' ? orphans : data.items.filter((item) => item.section === section.id);
    for (const item of members) {
      for (const row of [item, ...(splitsByParent.get(item.id) || [])]) {
        const isDone = itemState(row.id).done;
        if (section.id !== 'waiting') {
          total++;
          if (isDone) done++;
        }
        if (!(state.hideDone && isDone)) rows.push(renderTodo(row));
      }
    }
    if (!rows.length) continue;
    const head = el(section.collapsed ? 'summary' : 'h2', { class: 'section-head' }, section.title, el('span', { class: 'count' }, String(rows.length)));
    const body = el('ul', { class: 'todos' }, ...rows);
    list.append(section.collapsed
      ? el('details', { class: `section ${section.id}` }, head, body)
      : el('section', { class: `section ${section.id}` }, head, body));
  }

  if (!total) list.append(el('p', { class: 'empty' }, 'Nothing on your plate this morning.'));
  $('#progress').textContent = total ? (done === total ? 'All clear ✨' : `${done} of ${total} done`) : '';

  if (state.cleared?.generatedAt === data.generatedAt && state.cleared.items.length) {
    list.append(el('details', { class: 'cleared' },
      el('summary', {}, `${state.cleared.items.length} resolved overnight without you ticking them`),
      el('ul', {}, ...state.cleared.items.map((c) => el('li', {}, c.text))),
    ));
  }
}

// ---------- selection: tick off or split part of a todo ----------

function readSelection() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const host = (anchor.nodeType === 1 ? anchor : anchor.parentElement)?.closest('.todo-text');
  if (!host) return null;
  const before = document.createRange();
  before.selectNodeContents(host);
  before.setEnd(range.startContainer, range.startOffset);
  const raw = range.toString();
  if (!raw.trim()) return null;
  // Snap to whole words, so a drag that starts mid-word doesn't strike half of it.
  const full = host.textContent;
  const word = /[\p{L}\p{N}_'’-]/u;
  let start = before.toString().length + (raw.length - raw.trimStart().length);
  let end = start + raw.trim().length;
  while (start > 0 && word.test(full[start - 1]) && word.test(full[start])) start--;
  while (end < full.length && word.test(full[end]) && word.test(full[end - 1])) end++;
  return { id: host.dataset.id, start, end, text: full.slice(start, end), rect: range.getBoundingClientRect() };
}

function updateSelectionBar() {
  const bar = $('#selbar');
  const sel = readSelection();
  if (!sel) {
    // On touch screens, tapping the toolbar can clear the selection before the
    // tap lands, so keep the last selection briefly instead of dropping it.
    if (!bar.hidden) selectionClearedAt = Date.now();
    setTimeout(() => {
      if (!readSelection()) bar.hidden = true;
    }, 250);
    return;
  }
  pendingSelection = sel;
  selectionClearedAt = 0;
  bar.hidden = false;
  const above = sel.rect.top > 56;
  bar.style.left = `${sel.rect.left + sel.rect.width / 2 + scrollX}px`;
  bar.style.top = `${(above ? sel.rect.top - 46 : sel.rect.bottom + 8) + scrollY}px`;
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

function findItem(id) {
  return data.items.find((item) => item.id === id) || state.splits.find((split) => split.id === id);
}

function addRange(sel, range) {
  const s = itemState(sel.id);
  const text = findItem(sel.id).text;
  s.ranges = resolveRanges(text, s.ranges).filter((r) => !overlaps(r, sel));
  s.ranges.push({ start: sel.start, end: sel.end, text: sel.text, ...range });
}

function tickPart(sel) {
  addRange(sel, { kind: 'done' });
  finishSelectionAction();
}

function splitPart(sel) {
  const parent = findItem(sel.id);
  const id = `split:${crypto.randomUUID().slice(0, 8)}`;
  state.splits.push({
    id,
    parentId: parent.parentId || parent.id,
    section: parent.section,
    text: sel.text,
    links: parent.links || [],
    tags: [],
    createdAt: new Date().toISOString(),
    parentText: firstLine(parent.text).length > 60 ? `${firstLine(parent.text).slice(0, 59).trimEnd()}…` : firstLine(parent.text),
  });
  itemState(id);
  addRange(sel, { kind: 'moved', splitId: id });
  finishSelectionAction(id);
}

function finishSelectionAction(flashId) {
  save();
  getSelection().removeAllRanges();
  $('#selbar').hidden = true;
  render();
  if (flashId) flash(flashId);
}

function flash(id) {
  const row = document.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

function removeSplit(id) {
  state.splits = state.splits.filter((split) => split.id !== id);
  delete state.items[id];
  for (const s of Object.values(state.items)) s.ranges = s.ranges.filter((r) => r.splitId !== id);
  save();
  render();
}

// ---------- events ----------

let selectionTimer;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(updateSelectionBar, 60);
});

// Keep the text selected while clicking the toolbar.
$('#selbar').addEventListener('pointerdown', (event) => event.preventDefault());
$('#selbar').addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  const recent = selectionClearedAt === 0 || Date.now() - selectionClearedAt < 1500;
  const sel = readSelection() || (recent ? pendingSelection : null);
  if (!action || !sel) return;
  if (action === 'done') tickPart(sel);
  if (action === 'split') splitPart(sel);
});

$('#list').addEventListener('click', (event) => {
  const check = event.target.closest('[data-check]');
  if (check) {
    const s = itemState(check.dataset.check);
    s.done = !s.done;
    s.doneAt = s.done ? new Date().toISOString() : null;
    save();
    render();
    return;
  }
  const remove = event.target.closest('[data-remove]');
  if (remove) return removeSplit(remove.dataset.remove);

  if (!getSelection().isCollapsed) return;
  const part = event.target.closest('.part');
  if (!part) return;
  if (part.classList.contains('part-moved')) return flash(part.dataset.split);
  const id = part.closest('.todo-text').dataset.id;
  const s = itemState(id);
  const start = Number(part.dataset.start);
  s.ranges = resolveRanges(findItem(id).text, s.ranges).filter((r) => !(r.kind === 'done' && r.start === start));
  save();
  render();
});

$('#hide-done').addEventListener('change', (event) => {
  state.hideDone = event.target.checked;
  save();
  render();
});

$('#lock').addEventListener('click', () => {
  forgetPassphrase();
  location.reload();
});

function start() {
  reconcile();
  render();
}

boot();

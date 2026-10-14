const STATE_KEY = 'morning-todos:v2';
const PASS_KEY = 'morning-todos:passphrase';
const DAY = 864e5;
const $ = (selector) => document.querySelector(selector);

let data = null;
let state = loadState();
let pending = null;
let clearedAt = 0;

// ---------- saved ticks and splits ----------

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STATE_KEY));
  } catch {}
  return {
    items: raw?.items ?? {},   // id -> { done, ranges: [{ field, start, end, text, kind, splitId }], seenAt }
    splits: raw?.splits ?? [], // { id, parentId, section, title, links }
    hideDone: Boolean(raw?.hideDone),
  };
}

const save = () => localStorage.setItem(STATE_KEY, JSON.stringify(state));
const itemState = (id) => (state.items[id] ??= { done: false, ranges: [] });
const findItem = (id) => data.items.find((i) => i.id === id) || state.splits.find((s) => s.id === id);
const fieldText = (item, field) => (field === 'title' ? item.title : item.context?.[Number(field.slice(4))]?.text ?? '');

// ---------- load + decrypt ----------

async function getJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  return res?.ok ? res.json() : null;
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
  const sealed = await getJson('data/todos.enc.json');
  if (sealed) {
    const saved = localStorage.getItem(PASS_KEY);
    if (saved) data = await decrypt(sealed, saved).catch(() => null);
    if (!data) return showUnlock(sealed);
  } else {
    data = await getJson('data/preview.json');
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
    $('#unlock-btn').disabled = true;
    try {
      data = await decrypt(sealed, $('#passphrase').value);
      localStorage.setItem(PASS_KEY, $('#passphrase').value);
      form.hidden = true;
      start();
    } catch {
      $('#unlock-error').textContent = "That passphrase didn't work.";
    } finally {
      $('#unlock-btn').disabled = false;
    }
  };
}

function start() {
  const now = Date.now();
  for (const item of data.items) itemState(item.id).seenAt = now;
  for (const [id, s] of Object.entries(state.items)) {
    if (!id.startsWith('split:') && now - (s.seenAt || 0) > 14 * DAY) delete state.items[id];
  }
  save();
  render();
}

// ---------- render ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c != null && c !== ''));
  return node;
}

const pacific = (date, options) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...options }).format(date);

function ago(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / DAY);
  return days < 1 ? 'today' : days < 14 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

// Saved ranges are re-anchored by their text, so they survive small wording changes overnight.
function rangesFor(item, field) {
  const text = fieldText(item, field);
  return itemState(item.id).ranges
    .filter((r) => (r.field ?? 'title') === field)
    .map((r) => {
      if (text.slice(r.start, r.end) === r.text) return r;
      const at = text.indexOf(r.text);
      return at < 0 ? null : { ...r, start: at, end: at + r.text.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function highlightable(item, field, className) {
  const text = fieldText(item, field);
  const node = el('span', { class: `hl ${className}`, 'data-id': item.id, 'data-field': field });
  let pos = 0;
  for (const r of rangesFor(item, field)) {
    if (r.start < pos) continue;
    node.append(text.slice(pos, r.start), el('span', { class: `part-${r.kind}`, 'data-start': String(r.start), 'data-split': r.splitId }, text.slice(r.start, r.end)));
    pos = r.end;
  }
  node.append(text.slice(pos));
  return node;
}

function renderTodo(item) {
  const s = itemState(item.id);
  const isSplit = item.id.startsWith('split:');
  const meta = [
    ...(item.links || []).map((link) => el('a', { href: link.url, target: '_blank', rel: 'noopener' }, link.label)),
    ...(item.tags || []).map((tag) => el('span', { class: /fail|SLA|breach|urgent/i.test(tag) ? 'alert' : null }, tag)),
    item.since ? el('span', {}, ago(item.since)) : null,
    isSplit ? el('button', { class: 'remove', 'data-remove': item.id }, 'remove') : null,
  ].filter(Boolean);
  return el('li', { class: `todo${s.done ? ' done' : ''}${isSplit ? ' split' : ''}`, 'data-id': item.id },
    el('button', { class: 'check', role: 'checkbox', 'aria-checked': String(s.done), 'aria-label': 'Done', 'data-check': item.id }, '✓'),
    el('div', { class: 'body' },
      el('div', {}, highlightable(item, 'title', 'title')),
      ...(item.context || []).map((c, i) => el('div', { class: 'context' }, el('span', { class: 'who' }, `${c.who}:`), highlightable(item, `ctx:${i}`, ''))),
      meta.length ? el('div', { class: 'meta' }, ...meta) : null,
    ),
  );
}

function render() {
  const list = $('#list');
  list.replaceChildren();

  const generated = new Date(data.generatedAt);
  $('#today').textContent = pacific(new Date(), { weekday: 'long', month: 'long', day: 'numeric' });
  $('#refreshed').textContent = `Updated ${pacific(generated, { hour: 'numeric', minute: '2-digit' })}`;

  const problems = [];
  if (Date.now() - generated > 26 * 36e5) problems.push("This list is over a day old. This morning's refresh may have failed.");
  for (const [name, s] of Object.entries(data.sources || {})) if (!s.ok) problems.push(`${name[0].toUpperCase()}${name.slice(1)} ${s.skipped ? 'isn’t set up' : 'didn’t load'}.`);
  $('#notice').hidden = !problems.length;
  $('#notice').textContent = problems.join(' ');

  const byId = new Map(data.items.map((i) => [i.id, i]));
  const childSplits = new Map();
  const orphans = [];
  for (const split of state.splits) {
    if (byId.has(split.parentId)) childSplits.set(split.parentId, [...(childSplits.get(split.parentId) || []), split]);
    else orphans.push(split);
  }

  let total = 0;
  let done = 0;
  for (const section of [...data.sections, { id: 'orphans', title: 'Split out' }]) {
    const members = section.id === 'orphans' ? orphans : data.items.filter((i) => i.section === section.id);
    const rows = [];
    for (const item of members) {
      for (const row of [item, ...(childSplits.get(item.id) || [])]) {
        const isDone = itemState(row.id).done;
        if (section.id !== 'waiting') {
          total++;
          if (isDone) done++;
        }
        if (!(state.hideDone && isDone)) rows.push(renderTodo(row));
      }
    }
    if (!rows.length) continue;
    const label = `${section.title} (${rows.length})`;
    list.append(section.collapsed
      ? el('details', {}, el('summary', {}, el('h2', {}, label)), el('ul', {}, ...rows))
      : el('section', {}, el('h2', {}, label), el('ul', {}, ...rows)));
  }

  if (!total) list.append(el('p', { class: 'empty' }, 'Nothing on your plate this morning.'));
  $('#progress').textContent = total ? `${done} of ${total} done` : '';
  const toggle = $('#hide-done');
  toggle.hidden = !done;
  toggle.textContent = state.hideDone ? 'show done' : 'hide done';
}

// ---------- select part of a todo: tick it off or split it out ----------

function readSelection() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const host = (anchor.nodeType === 1 ? anchor : anchor.parentElement)?.closest('.hl');
  if (!host || !range.toString().trim()) return null;
  const before = document.createRange();
  before.selectNodeContents(host);
  before.setEnd(range.startContainer, range.startOffset);
  const raw = range.toString();
  const full = host.textContent;
  // Snap to whole words, so a drag that starts mid-word doesn't strike half of it.
  const word = /[\p{L}\p{N}_'’-]/u;
  let start = before.toString().length + (raw.length - raw.trimStart().length);
  let end = start + raw.trim().length;
  while (start > 0 && word.test(full[start - 1]) && word.test(full[start])) start--;
  while (end < full.length && word.test(full[end]) && word.test(full[end - 1])) end++;
  return { id: host.dataset.id, field: host.dataset.field, start, end, text: full.slice(start, end), rect: range.getBoundingClientRect() };
}

function updateBar() {
  const bar = $('#selbar');
  const sel = readSelection();
  if (!sel) {
    // On touch screens a tap on the bar can clear the selection first; keep it briefly.
    if (!bar.hidden) clearedAt = Date.now();
    setTimeout(() => {
      if (!readSelection()) bar.hidden = true;
    }, 250);
    return;
  }
  pending = sel;
  clearedAt = 0;
  bar.hidden = false;
  bar.style.left = `${sel.rect.left + sel.rect.width / 2 + scrollX}px`;
  bar.style.top = `${(sel.rect.top > 50 ? sel.rect.top - 40 : sel.rect.bottom + 8) + scrollY}px`;
}

function addRange(sel, extra) {
  const s = itemState(sel.id);
  const item = findItem(sel.id);
  const current = rangesFor(item, sel.field);
  const overlapping = current.filter((r) => r.start < sel.end && sel.start < r.end);
  s.ranges = s.ranges.filter((r) => !overlapping.some((o) => o.text === r.text && (o.field ?? 'title') === (r.field ?? 'title')));
  s.ranges.push({ field: sel.field, start: sel.start, end: sel.end, text: sel.text, ...extra });
}

function act(action, sel) {
  let flashId = null;
  if (action === 'done') addRange(sel, { kind: 'done' });
  if (action === 'split') {
    const parent = findItem(sel.id);
    flashId = `split:${crypto.randomUUID().slice(0, 8)}`;
    state.splits.push({ id: flashId, parentId: parent.parentId || parent.id, section: parent.section, title: sel.text, links: parent.links || [] });
    addRange(sel, { kind: 'moved', splitId: flashId });
  }
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

// ---------- events ----------

let timer;
document.addEventListener('selectionchange', () => {
  clearTimeout(timer);
  timer = setTimeout(updateBar, 60);
});

$('#selbar').addEventListener('pointerdown', (event) => event.preventDefault());
$('#selbar').addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  const recent = clearedAt === 0 || Date.now() - clearedAt < 1500;
  const sel = readSelection() || (recent ? pending : null);
  if (action && sel) act(action, sel);
});

$('#list').addEventListener('click', (event) => {
  const check = event.target.closest('[data-check]');
  if (check) {
    const s = itemState(check.dataset.check);
    s.done = !s.done;
    save();
    return render();
  }
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    const id = remove.dataset.remove;
    state.splits = state.splits.filter((s) => s.id !== id);
    delete state.items[id];
    for (const s of Object.values(state.items)) s.ranges = s.ranges.filter((r) => r.splitId !== id);
    save();
    return render();
  }
  if (!getSelection().isCollapsed) return;
  const moved = event.target.closest('.part-moved');
  if (moved) return flash(moved.dataset.split);
  const ticked = event.target.closest('.part-done');
  if (ticked) {
    const host = ticked.closest('.hl');
    const s = itemState(host.dataset.id);
    const target = rangesFor(findItem(host.dataset.id), host.dataset.field).find((r) => r.kind === 'done' && r.start === Number(ticked.dataset.start));
    s.ranges = s.ranges.filter((r) => !(target && r.text === target.text && (r.field ?? 'title') === host.dataset.field && r.kind === 'done'));
    save();
    render();
  }
});

$('#hide-done').addEventListener('click', () => {
  state.hideDone = !state.hideDone;
  save();
  render();
});

boot();

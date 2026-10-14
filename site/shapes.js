const NS = 'http://www.w3.org/2000/svg';

// Which solid each section is drawn as.
export const SHAPE_FOR = {
  urgent: 'star',
  prs: 'cube',
  merge: 'pyramid',
  reviews: 'sphere',
  slack: 'gem',
  linear: 'hex',
  cleanup: 'pent',
  orphans: 'sphere',
};

// Base colour per solid, as [hue, saturation, lightness].
const PALETTE = {
  star: [8, 80, 60],
  cube: [221, 82, 62],
  pyramid: [150, 48, 47],
  sphere: [40, 90, 57],
  gem: [266, 60, 64],
  hex: [188, 58, 45],
  pent: [215, 9, 62],
};

const LIGHT = Math.atan2(-1, -1); // light comes from the upper left
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tone = ([h, s, l], shift = 0) => `hsl(${h} ${s}% ${Math.max(10, Math.min(92, l + shift))}%)`;
const facing = (angle) => Math.cos(angle - LIGHT); // -1 (in shadow) .. 1 (facing the light)

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const pts = (list) => list.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
const face = (points, fill) => svg('polygon', { class: 'face', points: pts(points), fill, stroke: fill, 'stroke-width': '0.8', 'stroke-linejoin': 'round' });
const midAngle = (a, b) => Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));

// Gradients are shared by every SVG on the page, so they're defined once.
function ensureDefs() {
  if (document.getElementById('solid-defs')) return;
  const host = svg('svg', { id: 'solid-defs', width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute' });
  const defs = svg('defs');
  const sphere = svg('radialGradient', { id: 'solid-sphere', cx: '0.36', cy: '0.32', r: '0.75' });
  sphere.append(
    svg('stop', { offset: '0', 'stop-color': tone(PALETTE.sphere, 26) }),
    svg('stop', { offset: '0.45', 'stop-color': tone(PALETTE.sphere, 2) }),
    svg('stop', { offset: '1', 'stop-color': tone(PALETTE.sphere, -24) }),
  );
  const gloss = svg('radialGradient', { id: 'solid-gloss' });
  gloss.append(svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.75' }), svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
  defs.append(sphere, gloss);
  host.append(defs);
  document.body.prepend(host);
}

// An n-sided prism seen from slightly above: a lit top face plus the side faces turned toward you.
function prism(color, n, r, rotation, height) {
  const a = r * 0.92;
  const top = -r * 0.42;
  const v = Array.from({ length: n }, (_, k) => {
    const t = rotation + (2 * Math.PI * k) / n;
    return { t, x: a * Math.cos(t), y: top + a * 0.5 * Math.sin(t) };
  });
  const parts = [];
  for (let k = 0; k < n; k++) {
    const p = v[k];
    const q = v[(k + 1) % n];
    const mid = midAngle(p.t, q.t);
    if (Math.sin(mid) <= 0.05) continue;
    const normal = Math.atan2(Math.sin(mid) * 0.5, Math.cos(mid));
    parts.push(face([p, q, { x: q.x, y: q.y + height }, { x: p.x, y: p.y + height }], tone(color, -6 + facing(normal) * 16)));
  }
  parts.push(face(v, tone(color, 16)));
  return parts;
}

function buildSolid(type, r) {
  const color = PALETTE[type];
  if (type === 'sphere') {
    return [
      svg('circle', { class: 'face', r: r * 0.9, cy: -r * 0.05, fill: 'url(#solid-sphere)' }),
      svg('ellipse', { class: 'gloss', cx: -r * 0.32, cy: -r * 0.42, rx: r * 0.3, ry: r * 0.2, fill: 'url(#solid-gloss)' }),
    ];
  }
  if (type === 'cube') return prism(color, 4, r, 0, r * 0.82);
  if (type === 'hex') return prism(color, 6, r, 0, r * 0.72);
  if (type === 'pent') return prism(color, 5, r, -Math.PI / 2, r * 0.72);
  if (type === 'pyramid') {
    const apex = { x: 0, y: -r * 1.02 };
    const base = [0, 1, 2, 3].map((k) => {
      const t = (k * Math.PI) / 2;
      return { t, x: r * 0.98 * Math.cos(t), y: r * 0.42 + r * 0.98 * 0.45 * Math.sin(t) };
    });
    return [0, 1].map((k) => {
      const mid = midAngle(base[k].t, base[k + 1].t);
      return face([apex, base[k], base[k + 1]], tone(color, 4 + facing(Math.atan2(Math.sin(mid) * 0.5, Math.cos(mid))) * 16));
    });
  }
  if (type === 'gem') {
    const topV = { x: 0, y: -r * 1.02 };
    const bottomV = { x: 0, y: r * 0.98 };
    const ring = [0, 1, 2, 3].map((k) => {
      const t = (k * Math.PI) / 2;
      return { t, x: r * 0.82 * Math.cos(t), y: r * 0.82 * 0.32 * Math.sin(t) - r * 0.08 };
    });
    const parts = [];
    for (const k of [0, 1]) {
      const mid = midAngle(ring[k].t, ring[k + 1].t);
      const lit = facing(Math.atan2(Math.sin(mid) * 0.5, Math.cos(mid))) * 14;
      parts.push(face([topV, ring[k], ring[k + 1]], tone(color, 10 + lit)));
      parts.push(face([bottomV, ring[k], ring[k + 1]], tone(color, -12 + lit)));
    }
    return parts;
  }
  // A bevelled star: ten facets meeting at a raised centre, each lit by which way it leans.
  const centre = { x: 0, y: -r * 0.04 };
  const tips = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 ? r * 0.46 : r * 1.06;
    const t = -Math.PI / 2 + (i * Math.PI) / 5;
    return { t, x: radius * Math.cos(t), y: radius * Math.sin(t) };
  });
  return tips.map((p, i) => {
    const q = tips[(i + 1) % 10];
    const lean = Math.atan2((p.y + q.y) / 2 - centre.y, (p.x + q.x) / 2 - centre.x);
    return face([centre, p, q], tone(color, facing(lean) * 18));
  });
}

// A shaded solid, lit from the upper left.
export function solid(type, r) {
  ensureDefs();
  const group = svg('g');
  const body = svg('g', { class: 'solid' });
  body.append(...buildSolid(type, r));
  group.append(body);
  return group;
}

export function solidIcon(type, size, className = '') {
  const icon = svg('svg', { width: size, height: size, viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`, class: `icon ${className}`, 'aria-hidden': 'true' });
  icon.append(solid(type, size / 2 - 2));
  return icon;
}

// Sorted shapes live in a row of groups along the bottom. Each group is a column;
// its shapes are pulled toward the column's centre like a magnet and pushed off each
// other, so every group settles into a loose cluster.
export function createShapesView({ field, labels, onSelect, onPlaced, onMoved, onGroupClick, onRename }) {
  const bodies = new Map();
  let columns = []; // [{ id, name }]
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cols = svg('g', { class: 'cols' });
  field.append(cols);
  let size = { w: 0, h: 0 };
  let running = false;
  let frames = 0;
  let queue = Promise.resolve();
  let drag = null;
  let editing = null;

  function measure() {
    const rect = field.getBoundingClientRect();
    size = { w: rect.width, h: rect.height };
    field.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
  }
  new ResizeObserver(() => {
    measure();
    drawColumns();
    kick();
  }).observe(field);

  const slot = () => size.w / Math.max(1, columns.length);
  const anchorOf = (id) => {
    const i = Math.max(0, columns.findIndex((c) => c.id === id));
    return { x: (i + 0.5) * slot(), y: size.h * 0.56 };
  };
  const columnAt = (x) => columns[Math.min(columns.length - 1, Math.max(0, Math.floor(x / slot())))]?.id;
  const active = () => [...bodies.values()].filter((b) => !b.leaving);

  function makeBody(task, x, y) {
    const r = task.small ? 13 : 19;
    const body = { id: task.id, r, x, y, vx: 0, vy: 0, group: task.group };
    body.g = svg('g', { class: 'body', role: 'button', tabindex: '0', 'data-id': task.id });
    body.title = svg('title');
    body.g.append(body.title, solid(task.shape, r));
    field.append(body.g);
    bodies.set(task.id, body);
    return body;
  }

  // tasks: [{ id, shape, label, small, group, spawn? }]; groups: [{ id, name }] left to right.
  function sync(tasks, groups) {
    if (!size.w) measure();
    columns = groups;
    const keep = new Set(tasks.map((t) => t.id));
    for (const [id, body] of bodies) {
      if (!keep.has(id) && !body.leaving && !body.dragging) {
        body.g.remove();
        bodies.delete(id);
      }
    }
    for (const task of tasks) {
      const body = bodies.get(task.id);
      if (!body) {
        const start = task.spawn ?? { x: anchorOf(task.group).x + (Math.random() - 0.5) * 40, y: size.h + 40 };
        makeBody(task, start.x, start.y);
      } else if (!body.dragging) body.group = task.group;
      bodies.get(task.id).title.textContent = task.label;
    }
    drawColumns();
    draw();
    kick();
  }

  // One invisible column per group (it lights up on hover while sorting) with the group's name on top.
  function drawColumns() {
    cols.replaceChildren(...columns.map((c, i) => svg('rect', { class: 'col', 'data-group': c.id, x: i * slot() + 4, y: 0, width: slot() - 8, height: size.h, rx: 14 })));
    const fieldRect = field.getBoundingClientRect();
    const labelsRect = labels.getBoundingClientRect();
    labels.replaceChildren(...columns.map((c) => {
      const label = document.createElement('button');
      label.className = 'group-name';
      label.dataset.group = c.id;
      label.textContent = c.name || 'Untitled';
      label.title = 'Double-click to rename';
      label.style.left = `${fieldRect.left - labelsRect.left + anchorOf(c.id).x}px`;
      label.style.top = `${fieldRect.top - labelsRect.top + 10}px`;
      return label;
    }));
  }

  let lastFrameAt = 0;
  let watchdog = 0;
  function settleNow() {
    for (let i = 0; i < 600 && step() > 0.01 * bodies.size; i++);
    draw();
  }

  function kick() {
    frames = 0;
    // Pages that get no animation frames (hidden tabs, paused webviews) settle straight away.
    if (document.hidden) return settleNow();
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (performance.now() - lastFrameAt > 400) settleNow();
    }, 500);
  }
  document.addEventListener('visibilitychange', kick);

  function tick() {
    lastFrameAt = performance.now();
    running = true;
    const energy = step();
    draw();
    frames++;
    if (drag?.moved || frames < 30 || energy > 0.01 * bodies.size) requestAnimationFrame(tick);
    else running = false;
  }

  function step() {
    const list = active();
    for (const b of list) {
      if (b.dragging) continue;
      const a = anchorOf(b.group);
      b.vx = (b.vx + (a.x - b.x) * 0.02) * 0.82;
      b.vy = (b.vy + (a.y - b.y) * 0.02) * 0.82;
      b.x += b.vx;
      b.y += b.vy;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const c = list[j];
          let dx = c.x - a.x;
          let dy = c.y - a.y;
          if (!dx && !dy) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
          }
          const d = Math.hypot(dx, dy);
          const min = a.r + c.r + (a.group === c.group ? 8 : 28);
          if (d >= min) continue;
          const overlap = min - d;
          dx /= d;
          dy /= d;
          // The shape you're dragging stays under your pointer; only its neighbours move.
          const shareA = a.dragging ? 0 : c.dragging ? 1 : 0.5;
          a.x -= dx * overlap * shareA;
          a.y -= dy * overlap * shareA;
          c.x += dx * overlap * (1 - shareA);
          c.y += dy * overlap * (1 - shareA);
        }
      }
    }
    return list.reduce((sum, b) => sum + b.vx * b.vx + b.vy * b.vy, 0);
  }

  let paintOrder = '';
  function draw() {
    // Paint lower shapes last so they sit in front, like objects on a table.
    const ordered = active().sort((a, b) => a.y - b.y);
    for (const b of ordered) b.g.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`);
    const order = ordered.map((b) => b.id).join('|');
    if (order !== paintOrder) {
      paintOrder = order;
      for (const b of ordered) field.append(b.g);
    }
    for (const rect of cols.children) rect.classList.toggle('target', drag?.moved && drag.over === rect.dataset.group);
  }

  function select(id) {
    field.classList.toggle('has-selection', Boolean(id));
    for (const b of bodies.values()) b.g.classList.toggle('selected', b.id === id);
  }

  // ---------- clicking and dragging ----------

  const local = (event) => {
    const rect = field.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const inside = (p) => p.x >= 0 && p.x <= size.w && p.y >= -10 && p.y <= size.h;

  function startDrag(body, event) {
    drag.moved = true;
    field.setPointerCapture(event.pointerId);
    body.dragging = true;
    body.g.classList.add('dragging');
  }

  field.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const g = event.target.closest('.body:not(.leaving)');
    drag = { id: g?.dataset.id ?? null, x: event.clientX, y: event.clientY, moved: false, over: null, from: g ? bodies.get(g.dataset.id).group : null };
  });

  // Pick up the shape in the centre of the page and carry it down into a group.
  function carry(task, event) {
    const p = local(event);
    const body = makeBody({ ...task, group: null }, p.x, p.y);
    body.fromOutside = true;
    drag = { id: task.id, x: event.clientX, y: event.clientY, moved: false, over: null, from: null };
    startDrag(body, event);
    kick();
  }

  field.addEventListener('pointermove', (event) => {
    const p = local(event);
    if (!drag) return;
    const body = drag.id && bodies.get(drag.id);
    if (!body) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      startDrag(body, event);
    }
    body.x = p.x;
    body.y = p.y;
    body.vx = 0;
    body.vy = 0;
    drag.over = inside(p) ? columnAt(p.x) : null;
    kick();
  });

  function endDrag(event, cancelled) {
    if (!drag) return;
    const { id, moved, over, from } = drag;
    drag = null;
    if (!moved) {
      if (cancelled) return;
      // A click: on a shape, show it; on a group's empty space, sort the current todo there.
      if (id) onSelect(id);
      else {
        const p = local(event);
        if (inside(p)) onGroupClick(columnAt(p.x));
      }
      return;
    }
    const body = bodies.get(id);
    if (!body) return;
    body.dragging = false;
    body.g.classList.remove('dragging');
    if (cancelled || !over) {
      // Let go outside the groups: a carried shape goes back to the centre, others go home.
      if (body.fromOutside) {
        body.g.remove();
        bodies.delete(id);
        onPlaced(id, null);
      } else body.group = from;
    } else {
      body.group = over;
      if (body.fromOutside) onPlaced(id, over);
      else if (over !== from) onMoved(id, over);
    }
    body.fromOutside = false;
    draw();
    kick();
  }
  field.addEventListener('pointerup', (event) => endDrag(event, false));
  field.addEventListener('pointercancel', (event) => endDrag(event, true));

  field.addEventListener('keydown', (event) => {
    const body = event.target.closest('.body');
    if (body && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelect(body.dataset.id);
    }
  });

  // Click a group's name to sort into it; double-click to rename it.
  labels.addEventListener('click', (event) => {
    const label = event.target.closest('.group-name');
    if (label && !editing && event.detail < 2) onGroupClick(label.dataset.group);
  });
  labels.addEventListener('dblclick', (event) => {
    const label = event.target.closest('.group-name');
    if (!label || editing) return;
    const id = label.dataset.group;
    editing = id;
    const input = document.createElement('input');
    input.className = 'group-name-input';
    input.value = columns.find((c) => c.id === id)?.name ?? '';
    label.replaceChildren(input);
    input.focus();
    input.select();
    const finish = (commit) => {
      if (editing !== id) return;
      editing = null;
      onRename(id, commit ? input.value.trim() : null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  });

  // ---------- completing ----------

  // A finished todo flies into its counter on the scorecard. `from` is a screen rect
  // for a shape that isn't in a group (the one in the centre); `to` is the counter.
  function complete(id, type, from, to) {
    const body = bodies.get(id);
    if (body) {
      body.leaving = true;
      body.g.classList.remove('selected');
      body.g.classList.add('leaving');
    }
    queue = queue.then(() => fly(id, body, type, from, to));
    return queue;
  }

  async function fly(id, body, type, fromRect, to) {
    const toEl = typeof to === 'function' ? to() : to;
    const fieldRect = field.getBoundingClientRect();
    const start = body
      ? { x: fieldRect.left + body.x, y: fieldRect.top + body.y, r: body.r }
      : fromRect
        ? { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2, r: fromRect.width / 2 - 4 }
        : null;
    if (body) {
      body.g.remove();
      bodies.delete(id);
      kick();
    }
    if (start && toEl) {
      const toRect = toEl.getBoundingClientRect();
      const end = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };
      const box = start.r * 2 + 8;
      const flyer = svg('svg', { class: 'flyer', width: box, height: box, viewBox: `${-box / 2} ${-box / 2} ${box} ${box}` });
      flyer.append(solid(type, start.r));
      flyer.style.left = `${start.x - box / 2}px`;
      flyer.style.top = `${start.y - box / 2}px`;
      document.body.append(flyer);
      const scale = (toRect.width / 2 - 1) / start.r;
      const flight = flyer.animate(
        [
          { transform: 'translate(0, 0) scale(1)' },
          { transform: `translate(${(end.x - start.x) * 0.45}px, ${(end.y - start.y) * 0.45 - 60}px) scale(${(1 + scale) / 2 + 0.1})`, offset: 0.45 },
          { transform: `translate(${end.x - start.x}px, ${end.y - start.y}px) scale(${scale})` },
        ],
        { duration: reduced ? 0 : 700, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
      );
      // If animations are paused (hidden tab, paused webview), land anyway rather than stall the queue.
      const landIfHidden = () => document.hidden && flight.finish();
      landIfHidden();
      document.addEventListener('visibilitychange', landIfHidden);
      const backstop = setTimeout(() => flight.playState !== 'finished' && flight.finish(), 1300);
      await flight.finished;
      clearTimeout(backstop);
      document.removeEventListener('visibilitychange', landIfHidden);
      flyer.remove();
    }
    await wait(reduced ? 0 : 80);
  }

  return {
    sync,
    select,
    complete,
    carry,
    toField: (clientX, clientY) => {
      const rect = field.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
  };
}

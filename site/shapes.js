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

// Every shape is pulled toward its group's anchor like a magnet and pushed off
// its neighbours, so groups settle into loose clusters. The main group's anchor is
// the centre of the screen; groups you make by dragging sit where you made them.
export function createShapesView({ field, shelf, onSelect, onBackground, onLanded, onLayout }) {
  const bodies = new Map();
  const groups = new Map(); // id -> { x, y } for groups you've made; 'main' is always the centre
  const flying = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const halos = svg('g', { class: 'halos' });
  field.append(halos);
  let size = { w: 0, h: 0 };
  let running = false;
  let frames = 0;
  let queue = Promise.resolve();
  let drag = null;

  function measure() {
    const rect = field.getBoundingClientRect();
    const old = size;
    size = { w: rect.width, h: rect.height };
    field.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    // Keep made groups in the same relative spot when the window changes size.
    if (old.w && size.w) {
      for (const g of groups.values()) {
        g.x *= size.w / old.w;
        g.y *= size.h / old.h;
      }
    }
  }
  new ResizeObserver(() => {
    measure();
    kick();
  }).observe(field);

  const anchorOf = (id) => (id !== 'main' && groups.get(id)) || { x: size.w / 2, y: size.h / 2 };
  const active = () => [...bodies.values()].filter((b) => !b.leaving);

  // tasks: [{ id, shape, label, small, group }], anchors: { groupId: { fx, fy } } as fractions of the field.
  function sync(tasks, anchors = {}) {
    if (!size.w) measure();
    for (const [id, a] of Object.entries(anchors)) {
      if (!groups.has(id)) groups.set(id, { x: a.fx * size.w, y: a.fy * size.h });
    }
    const keep = new Set(tasks.map((t) => t.id));
    for (const [id, body] of bodies) {
      if (!keep.has(id) && !body.leaving) {
        body.g.remove();
        bodies.delete(id);
      }
    }
    for (const task of tasks) {
      let body = bodies.get(task.id);
      if (!body) {
        const r = task.small ? 15 : 23;
        const angle = Math.random() * Math.PI * 2;
        const distance = (reduced ? 40 : Math.max(size.w, size.h, 600) * 0.6) * (0.9 + Math.random() * 0.2);
        body = { id: task.id, r, x: size.w / 2 + Math.cos(angle) * distance, y: size.h / 2 + Math.sin(angle) * distance, vx: 0, vy: 0 };
        body.g = svg('g', { class: 'body', role: 'button', tabindex: '0', 'data-id': task.id });
        body.title = svg('title');
        body.g.append(body.title, solid(task.shape, r));
        field.append(body.g);
        bodies.set(task.id, body);
        body.group = groups.has(task.group) ? task.group : 'main';
      }
      body.shape = task.shape;
      body.title.textContent = task.label;
      body.g.setAttribute('aria-label', task.label);
    }
    dropEmptyGroups();
    draw();
    kick();
  }

  function dropEmptyGroups() {
    const used = new Set(active().map((b) => b.group));
    for (const id of groups.keys()) if (!used.has(id)) groups.delete(id);
  }

  function layout() {
    const anchors = {};
    for (const [id, g] of groups) anchors[id] = { fx: g.x / size.w, fy: g.y / size.h };
    const membership = {};
    for (const b of active()) if (b.group !== 'main') membership[b.id] = b.group;
    return { anchors, membership };
  }

  let lastFrameAt = 0;
  let watchdog = 0;
  function settleNow() {
    for (let i = 0; i < 600 && step() > 0.01 * bodies.size; i++);
    draw();
  }

  function kick() {
    frames = 0;
    // Pages that get no animation frames (hidden tabs, paused webviews) settle straight away
    // instead of leaving shapes frozen mid-flight.
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
    else {
      running = false;
      onLayout(layout());
    }
  }

  function step() {
    const list = active();
    for (const b of list) {
      if (b.dragging) continue;
      const a = anchorOf(b.group);
      const pull = b.group === 'main' ? 0.012 : 0.022;
      b.vx = (b.vx + (a.x - b.x) * pull) * 0.84;
      b.vy = (b.vy + (a.y - b.y) * pull) * 0.84;
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
            // Exactly on top of each other: nudge in a random direction so they can separate.
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
          }
          const d = Math.hypot(dx, dy);
          // Shapes in different groups keep a wider gap, so groups read as separate.
          const min = a.r + c.r + (a.group === c.group ? 10 : 36);
          if (d >= min) continue;
          const overlap = min - d;
          dx /= d;
          dy /= d;
          // The shape you're dragging stays under your finger; only its neighbours move.
          const shareA = a.dragging ? 0 : c.dragging ? 1 : 0.5;
          a.x -= dx * overlap * shareA;
          a.y -= dy * overlap * shareA;
          c.x += dx * overlap * (1 - shareA);
          c.y += dy * overlap * (1 - shareA);
        }
      }
    }
    separateGroups(list);
    return list.reduce((sum, b) => sum + b.vx * b.vx + b.vy * b.vy, 0);
  }

  // Groups you've made drift apart from each other and from the main cluster if they crowd it.
  function separateGroups(list) {
    const counts = new Map();
    for (const b of list) counts.set(b.group, (counts.get(b.group) || 0) + 1);
    const reach = (id) => Math.sqrt(counts.get(id) || 1) * 26 + 24;
    const ids = ['main', ...groups.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = anchorOf(ids[i]);
        const c = anchorOf(ids[j]);
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = reach(ids[i]) + reach(ids[j]) + 24;
        if (d >= min) continue;
        const push = (min - d) * 0.08;
        const movable = [ids[i], ids[j]].filter((id) => id !== 'main');
        for (const id of movable) {
          const g = groups.get(id);
          const sign = id === ids[i] ? -1 : 1;
          g.x += (sign * dx * push) / d / movable.length;
          g.y += (sign * dy * push) / d / movable.length;
        }
      }
    }
    for (const [id, g] of groups) {
      const margin = reach(id);
      g.x = Math.min(Math.max(g.x, margin), size.w - margin);
      g.y = Math.min(Math.max(g.y, margin), size.h - margin);
    }
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
    drawHalos(ordered);
  }

  // A faint dashed outline around each group you've made, so it reads as a bucket.
  function drawHalos(list) {
    const members = new Map();
    for (const b of list) {
      if (b.group === 'main' || b.dragging) continue;
      if (!members.has(b.group)) members.set(b.group, []);
      members.get(b.group).push(b);
    }
    const seen = new Set();
    for (const [id, group] of members) {
      if (group.length < 2) continue;
      seen.add(id);
      const cx = group.reduce((s, b) => s + b.x, 0) / group.length;
      const cy = group.reduce((s, b) => s + b.y, 0) / group.length;
      const r = Math.max(...group.map((b) => Math.hypot(b.x - cx, b.y - cy) + b.r)) + 14;
      let halo = halos.querySelector(`[data-group="${id}"]`);
      if (!halo) halos.append((halo = svg('circle', { class: 'halo', 'data-group': id })));
      halo.setAttribute('cx', cx.toFixed(1));
      halo.setAttribute('cy', cy.toFixed(1));
      halo.setAttribute('r', r.toFixed(1));
      halo.classList.toggle('target', drag?.target?.group === id);
    }
    for (const halo of [...halos.children]) if (!seen.has(halo.dataset.group)) halo.remove();
  }

  function select(id) {
    field.classList.toggle('has-selection', Boolean(id));
    for (const b of bodies.values()) b.g.classList.toggle('selected', b.id === id);
  }

  // ---------- dragging ----------

  const local = (event) => {
    const rect = field.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // The closest shape you're near enough to stick to, if any.
  function magnetFor(body) {
    let best = null;
    let bestDistance = Infinity;
    for (const other of active()) {
      if (other === body) continue;
      const d = Math.hypot(other.x - body.x, other.y - body.y);
      if (d < other.r + body.r + 34 && d < bestDistance) {
        best = other;
        bestDistance = d;
      }
    }
    return best;
  }

  field.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const g = event.target.closest('.body:not(.leaving)');
    drag = { id: g?.dataset.id ?? null, x: event.clientX, y: event.clientY, moved: false, target: null };
  });

  field.addEventListener('pointermove', (event) => {
    if (!drag?.id) return;
    const body = bodies.get(drag.id);
    if (!body) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.moved = true;
      field.setPointerCapture(event.pointerId);
      body.dragging = true;
      body.g.classList.add('dragging');
    }
    const p = local(event);
    body.x = p.x;
    body.y = p.y;
    body.vx = 0;
    body.vy = 0;
    const target = magnetFor(body);
    if (target !== drag.target) {
      drag.target?.g.classList.remove('magnet');
      target?.g.classList.add('magnet');
      drag.target = target;
    }
    kick();
  });

  function endDrag(event, cancelled) {
    if (!drag) return;
    const { id, moved, target } = drag;
    drag = null;
    if (!moved) {
      if (cancelled) return;
      if (id) onSelect(id);
      else onBackground();
      return;
    }
    const body = bodies.get(id);
    target?.g.classList.remove('magnet');
    if (!body) return;
    body.dragging = false;
    body.g.classList.remove('dragging');
    if (target) {
      // Dropped next to a shape: join its group (or the main cluster).
      body.group = target.group;
    } else {
      // Dropped in open space: this shape starts a new group right here.
      const groupId = `g${Math.random().toString(36).slice(2, 8)}`;
      groups.set(groupId, { x: body.x, y: body.y });
      body.group = groupId;
    }
    dropEmptyGroups();
    onLayout(layout());
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

  // ---------- completing ----------

  // The shape flies from its group into its socket on the shelf, and the socket
  // fills in when it lands. Several completions take turns.
  function complete(id, type) {
    const body = bodies.get(id);
    flying.add(id);
    if (body) {
      body.leaving = true;
      body.g.classList.remove('selected');
      body.g.classList.add('leaving');
    }
    queue = queue.then(() => fly(id, body, type));
    return queue;
  }

  async function fly(id, body, type) {
    const socket = shelf.querySelector(`[data-slot="${CSS.escape(id)}"]`);
    if (body && socket) {
      const fieldRect = field.getBoundingClientRect();
      const socketRect = socket.getBoundingClientRect();
      const from = { x: fieldRect.left + body.x, y: fieldRect.top + body.y };
      const to = { x: socketRect.left + socketRect.width / 2, y: socketRect.top + socketRect.height / 2 };
      const box = body.r * 2 + 8;
      const flyer = svg('svg', { class: 'flyer', width: box, height: box, viewBox: `${-box / 2} ${-box / 2} ${box} ${box}` });
      flyer.append(solid(type, body.r));
      flyer.style.left = `${from.x - box / 2}px`;
      flyer.style.top = `${from.y - box / 2}px`;
      document.body.append(flyer);
      body.g.remove();
      bodies.delete(id);
      dropEmptyGroups();
      kick();
      const scale = (socketRect.width / 2 - 2) / body.r;
      const lift = Math.min(120, Math.abs(to.y - from.y) * 0.35);
      const flight = flyer.animate(
        [
          { transform: 'translate(0, 0) scale(1)' },
          { transform: `translate(${(to.x - from.x) * 0.5}px, ${(to.y - from.y) * 0.5 - lift}px) scale(${(1 + scale) / 2 + 0.15})`, offset: 0.45 },
          { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${scale})` },
        ],
        { duration: reduced ? 0 : 750, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
      );
      // If animations are paused (hidden tab, paused webview), land anyway rather than stall the queue.
      const landIfHidden = () => document.hidden && flight.finish();
      landIfHidden();
      document.addEventListener('visibilitychange', landIfHidden);
      const backstop = setTimeout(() => flight.playState !== 'finished' && flight.finish(), 1400);
      await flight.finished;
      clearTimeout(backstop);
      document.removeEventListener('visibilitychange', landIfHidden);
      flyer.remove();
    } else if (body) {
      body.g.remove();
      bodies.delete(id);
      dropEmptyGroups();
      kick();
    }
    flying.delete(id);
    // The app redraws the shelf from saved state, so a socket only fills if the todo is still done.
    onLanded(id);
    await wait(reduced ? 0 : 120);
  }

  return { sync, select, complete, kick, isFlying: (id) => flying.has(id) };
}

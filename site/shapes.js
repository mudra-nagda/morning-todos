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
  const shadow = svg('radialGradient', { id: 'solid-shadow' });
  shadow.append(svg('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': '0.3' }), svg('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '0' }));
  const sphere = svg('radialGradient', { id: 'solid-sphere', cx: '0.36', cy: '0.32', r: '0.75' });
  sphere.append(
    svg('stop', { offset: '0', 'stop-color': tone(PALETTE.sphere, 26) }),
    svg('stop', { offset: '0.45', 'stop-color': tone(PALETTE.sphere, 2) }),
    svg('stop', { offset: '1', 'stop-color': tone(PALETTE.sphere, -24) }),
  );
  const gloss = svg('radialGradient', { id: 'solid-gloss' });
  gloss.append(svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.75' }), svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
  defs.append(shadow, sphere, gloss);
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

// A shaded solid with a soft contact shadow underneath it.
export function solid(type, r, { shadow = true } = {}) {
  ensureDefs();
  const group = svg('g');
  if (shadow) group.append(svg('ellipse', { class: 'contact', cx: 0, cy: r * 1.02, rx: r * 0.86, ry: r * 0.22, fill: 'url(#solid-shadow)' }));
  const body = svg('g', { class: 'solid' });
  body.append(...buildSolid(type, r));
  group.append(body);
  return group;
}

export function solidIcon(type, size, className = '') {
  const icon = svg('svg', { width: size, height: size, viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`, class: `icon ${className}`, 'aria-hidden': 'true' });
  icon.append(solid(type, size / 2 - 2, { shadow: false }));
  return icon;
}

// Shapes are pulled toward the centre like a magnet and pushed apart where they
// overlap, so they settle into a loose cluster. The loop sleeps once things stop moving.
export function createShapesView({ field, shelf, onSelect, onBackground, onLanded }) {
  const bodies = new Map();
  const flying = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let size = { w: 0, h: 0 };
  let running = false;
  let frames = 0;
  let queue = Promise.resolve();

  function measure() {
    const rect = field.getBoundingClientRect();
    size = { w: rect.width, h: rect.height };
    field.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
  }
  new ResizeObserver(() => {
    measure();
    kick();
  }).observe(field);

  function sync(tasks) {
    if (!size.w) measure();
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
      }
      body.shape = task.shape;
      body.title.textContent = task.label;
      body.g.setAttribute('aria-label', task.label);
    }
    draw();
    kick();
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
    if (frames < 30 || energy > 0.01 * bodies.size) requestAnimationFrame(tick);
    else running = false;
  }

  function step() {
    const active = [...bodies.values()].filter((b) => !b.leaving);
    const cx = size.w / 2;
    const cy = size.h / 2;
    for (const b of active) {
      b.vx = (b.vx + (cx - b.x) * 0.012) * 0.84;
      b.vy = (b.vy + (cy - b.y) * 0.012) * 0.84;
      b.x += b.vx;
      b.y += b.vy;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i];
          const c = active[j];
          let dx = c.x - a.x;
          let dy = c.y - a.y;
          if (!dx && !dy) {
            // Exactly on top of each other: nudge in a random direction so they can separate.
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
          }
          const d = Math.hypot(dx, dy);
          const min = a.r + c.r + 10;
          if (d >= min) continue;
          const push = (min - d) / 2;
          dx /= d;
          dy /= d;
          a.x -= dx * push;
          a.y -= dy * push;
          c.x += dx * push;
          c.y += dy * push;
        }
      }
    }
    return active.reduce((sum, b) => sum + b.vx * b.vx + b.vy * b.vy, 0);
  }

  let paintOrder = '';
  function draw() {
    // Paint lower shapes last so they sit in front, like objects on a table.
    const ordered = [...bodies.values()].filter((b) => !b.leaving).sort((a, b) => a.y - b.y);
    for (const b of ordered) b.g.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`);
    const order = ordered.map((b) => b.id).join('|');
    if (order !== paintOrder) {
      paintOrder = order;
      for (const b of ordered) field.append(b.g);
    }
  }

  function select(id) {
    field.classList.toggle('has-selection', Boolean(id));
    for (const b of bodies.values()) b.g.classList.toggle('selected', b.id === id);
  }

  // The shape flies from the cluster into its socket on the shelf, and the
  // socket fills in when it lands. Several completions take turns.
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
      flyer.append(solid(type, body.r, { shadow: false }));
      flyer.style.left = `${from.x - box / 2}px`;
      flyer.style.top = `${from.y - box / 2}px`;
      document.body.append(flyer);
      body.g.remove();
      bodies.delete(id);
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
      kick();
    }
    flying.delete(id);
    // The app redraws the shelf from saved state, so a socket only fills if the todo is still done.
    onLanded(id);
    await wait(reduced ? 0 : 120);
  }

  field.addEventListener('click', (event) => {
    const body = event.target.closest('.body:not(.leaving)');
    if (body) onSelect(body.dataset.id);
    else onBackground();
  });
  field.addEventListener('keydown', (event) => {
    const body = event.target.closest('.body');
    if (body && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelect(body.dataset.id);
    }
  });

  return { sync, select, complete, kick, isFlying: (id) => flying.has(id) };
}

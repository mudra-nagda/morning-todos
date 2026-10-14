const NS = 'http://www.w3.org/2000/svg';

export const SHAPE_FOR = {
  urgent: 'star',
  prs: 'square',
  merge: 'triangle',
  reviews: 'circle',
  slack: 'diamond',
  linear: 'hexagon',
  cleanup: 'pentagon',
  orphans: 'circle',
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const points = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
const regular = (n, r, rotation = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => [r * Math.cos(rotation + (2 * Math.PI * i) / n), r * Math.sin(rotation + (2 * Math.PI * i) / n)]);

export function shapeNode(shape, r) {
  let node;
  if (shape === 'circle') node = svg('circle', { r: r * 0.9 });
  else if (shape === 'square') {
    const s = r * 0.8;
    node = svg('rect', { x: -s, y: -s, width: 2 * s, height: 2 * s, rx: r * 0.16 });
  } else if (shape === 'triangle') node = svg('polygon', { points: points(regular(3, r * 1.08).map(([x, y]) => [x, y + r * 0.18])) });
  else if (shape === 'diamond') node = svg('polygon', { points: points(regular(4, r)) });
  else if (shape === 'hexagon') node = svg('polygon', { points: points(regular(6, r * 0.95, 0)) });
  else if (shape === 'pentagon') node = svg('polygon', { points: points(regular(5, r * 0.95)) });
  else {
    const star = Array.from({ length: 10 }, (_, i) => {
      const radius = i % 2 ? r * 0.48 : r * 1.05;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      return [radius * Math.cos(angle), radius * Math.sin(angle)];
    });
    node = svg('polygon', { points: points(star) });
  }
  node.setAttribute('class', 'shape');
  return node;
}

export function shapeIcon(shape, size) {
  const icon = svg('svg', { width: size, height: size, viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`, class: 'icon', 'aria-hidden': 'true' });
  icon.append(shapeNode(shape, size / 2 - 2));
  return icon;
}

// Shapes are pulled toward the centre like a magnet and pushed apart where they
// overlap, so they settle into a loose cluster. The loop sleeps once things stop moving.
export function createShapesView({ field, tray, onSelect, onBackground }) {
  const bodies = new Map();
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
        const r = task.small ? 13 : 20;
        const angle = Math.random() * Math.PI * 2;
        const distance = (reduced ? 40 : Math.max(size.w, size.h, 600) * 0.6) * (0.9 + Math.random() * 0.2);
        body = { id: task.id, r, x: size.w / 2 + Math.cos(angle) * distance, y: size.h / 2 + Math.sin(angle) * distance, vx: 0, vy: 0 };
        body.g = svg('g', { class: 'body', role: 'button', tabindex: '0', 'data-id': task.id });
        body.title = svg('title');
        body.g.append(body.title, shapeNode(task.shape, r));
        field.append(body.g);
        bodies.set(task.id, body);
      }
      body.shape = task.shape;
      body.title.textContent = task.label;
      body.g.setAttribute('aria-label', task.label);
      body.g.classList.toggle('urgent', Boolean(task.urgent));
    }
    draw();
    kick();
  }

  function kick() {
    frames = 0;
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }

  function tick() {
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
          const min = a.r + c.r + 8;
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
    draw();
    const energy = active.reduce((sum, b) => sum + b.vx * b.vx + b.vy * b.vy, 0);
    frames++;
    if (frames < 30 || energy > 0.01 * active.length) requestAnimationFrame(tick);
    else running = false;
  }

  function draw() {
    for (const b of bodies.values()) {
      if (!b.leaving) b.g.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`);
    }
  }

  function select(id) {
    for (const b of bodies.values()) b.g.classList.toggle('selected', b.id === id);
  }

  // A tray of slots for this shape rises from the bottom, the shape flies into
  // its slot, the slot fills, and the tray drops away. Completions queue up.
  function complete(id, { shape, title, slots }) {
    const body = bodies.get(id);
    if (body) {
      body.leaving = true;
      body.g.classList.remove('selected');
    }
    queue = queue.then(() => fly(id, body, { shape, title, slots }));
    return queue;
  }

  async function fly(id, body, { shape, title, slots }) {
    const row = document.createElement('div');
    row.className = 'slots';
    let target = null;
    for (const slot of slots) {
      const icon = shapeIcon(shape, 30);
      icon.classList.add('slot');
      if (slot.done) icon.classList.add('filled');
      if (slot.id === id) target = icon;
      row.append(icon);
    }
    const label = document.createElement('div');
    label.className = 'tray-label';
    label.textContent = title;
    tray.replaceChildren(label, row);
    tray.hidden = false;
    requestAnimationFrame(() => tray.classList.add('open'));
    await wait(reduced ? 0 : 380);

    if (body && target) {
      const fieldRect = field.getBoundingClientRect();
      const slotRect = target.getBoundingClientRect();
      const from = { x: fieldRect.left + body.x, y: fieldRect.top + body.y };
      const to = { x: slotRect.left + slotRect.width / 2, y: slotRect.top + slotRect.height / 2 };
      const box = body.r * 2 + 6;
      const flyer = svg('svg', { class: 'flyer', width: box, height: box, viewBox: `${-box / 2} ${-box / 2} ${box} ${box}` });
      flyer.append(shapeNode(shape, body.r));
      flyer.style.left = `${from.x - box / 2}px`;
      flyer.style.top = `${from.y - box / 2}px`;
      if (body.g.classList.contains('urgent')) flyer.classList.add('urgent');
      document.body.append(flyer);
      body.g.remove();
      bodies.delete(id);
      kick();
      const scale = (slotRect.width / 2 - 2) / body.r;
      await flyer.animate(
        [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${scale})` }],
        { duration: reduced ? 0 : 650, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' },
      ).finished;
      flyer.remove();
    } else if (body) {
      body.g.remove();
      bodies.delete(id);
      kick();
    }
    target?.classList.add('filled');
    await wait(reduced ? 400 : 1000);
    tray.classList.remove('open');
    await wait(reduced ? 0 : 380);
    tray.hidden = true;
  }

  field.addEventListener('click', (event) => {
    const body = event.target.closest('.body');
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

  return { sync, select, complete, kick, isEmpty: () => ![...bodies.values()].some((b) => !b.leaving) };
}

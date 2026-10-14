(() => {
  'use strict';

  const STORAGE_KEY = 'starmaker.gallery.v1';
  const HIT = 16; // px radius for grabbing a star
  const HOLD_MS = 550; // press-and-hold duration that removes a star
  const TAU = Math.PI * 2;
  const TINTS = ['255,255,255', '205,220,255', '255,232,205'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    name: $('name'),
    lore: $('lore'),
    stats: $('stats'),
    hint: $('hint'),
    toast: $('toast'),
    gallery: $('gallery'),
    galleryList: $('gallery-list'),
    galleryCount: $('gallery-count'),
    galleryBtn: $('btn-gallery'),
    galleryBtn: $('btn-gallery'),
    galleryBtn: $('btn-gallery'),
    galleryBtn: $('btn-gallery'),
    galleryBtn: $('btn-gallery'),
    galleryBtn: $('btn-gallery'),
  };

  // ---------- small helpers ----------

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'constellation';

  // ---------- names & lore ----------

  const ADJ = ['Weeping', 'Silent', 'Wandering', 'Broken', 'Gilded', 'Sleeping', 'Hollow', 'Burning',
    'Forgotten', 'Lesser', 'Greater', 'Crooked', 'Patient', 'Drowned', 'Laughing', 'Restless', 'Northern'];
  const NOUN = ['Lantern', 'Heron', 'Kettle', 'Crown', 'Fox', 'Ladder', 'Violin', 'Serpent', 'Anchor',
    'Moth', 'Teapot', 'Archer', 'Whale', 'Key', 'Lighthouse', 'Comb', 'Stag', 'Umbrella', 'Hourglass', 'Owl'];
  const OWNER = ['Orrin', 'Maelis', 'Ysolde', 'Tobias', 'Pell', 'Grandmother', 'The Cartographer',
    'The Ferryman', 'Old Wen', 'The Baker'];
  const SEASON = ['early spring', 'late spring', 'midsummer', 'late summer', 'autumn', 'deep winter', 'the week of first frost'];
  const HEIGHT = ['low', 'high', 'halfway up', 'just above the horizon'];
  const DIR = ['northern', 'eastern', 'southern', 'western', 'north-eastern', 'south-western'];

  const randomName = () =>
    Math.random() < 0.55 ? `The ${pick(ADJ)} ${pick(NOUN)}` : `${pick(OWNER)}'s ${pick(NOUN)}`;
  const randomLore = () => `Best seen in ${pick(SEASON)}, ${pick(HEIGHT)} in the ${pick(DIR)} sky.`;

  // ---------- state ----------
  // Star coordinates are stored relative to the screen centre, in units of the
  // shorter screen side, so drawings keep their shape when the window resizes.

  let state = freshState();
  let undoStack = [];
  let nextId = 1;
  let selectedId = null;
  let hoverId = null;
  let drag = null;
  let lastWheelSnapshot = 0;
  const bornAt = new Map(); // star id -> time it should pop in

  let W = 0, H = 0, S = 1, DPR = 1;
  let bgLayer = null;
  let bgStars = [];
  let meteor = null;
  let nextMeteorAt = performance.now() + 4000;

  function freshState() {
    return { galleryId: null, name: '', lore: randomLore(), stars: [], links: [] };
  }

  const toPx = (s) => ({ x: W / 2 + s.x * S, y: H / 2 + s.y * S });
  const toUnit = (x, y) => ({ x: (x - W / 2) / S, y: (y - H / 2) / S });
  const byId = (id) => state.stars.find((s) => s.id === id);
  const hasLink = (a, b) => state.links.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

  function starAt(x, y, excludeId) {
    let best = null;
    let bestD = HIT;
    for (const s of state.stars) {
      if (s.id === excludeId) continue;
      const p = toPx(s);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) { best = s; bestD = d; }
    }
    return best;
  }

  function snapshot() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 100) undoStack.shift();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return toast('Nothing to undo');
    setState(JSON.parse(prev));
  }

  function setState(next, { animate = false } = {}) {
    state = next;
    nextId = state.stars.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    selectedId = hoverId = null;
    bornAt.clear();
    if (animate) {
      const now = performance.now();
      state.stars.forEach((s, i) => bornAt.set(s.id, now + i * 90));
    }
    syncUI();
  }

  function addStar(x, y) {
    const u = toUnit(x, y);
    const star = { id: nextId++, x: u.x, y: u.y, r: rand(1.6, 3.2), c: Math.floor(Math.random() * TINTS.length) };
    state.stars.push(star);
    bornAt.set(star.id, performance.now());
    return star;
  }

  function removeStar(id) {
    state.stars = state.stars.filter((s) => s.id !== id);
    state.links = state.links.filter(([a, b]) => a !== id && b !== id);
    if (selectedId === id) selectedId = null;
    if (hoverId === id) hoverId = null;
  }

  function toggleLink(a, b) {
    if (a === b) return;
    const i = state.links.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
    if (i >= 0) state.links.splice(i, 1);
    else state.links.push([a, b]);
  }

  function randomConstellation(recordUndo = true) {
    const n = 5 + Math.floor(Math.random() * 5);
    const sx = 0.36 * Math.min(W / S, 1.6);
    const sy = 0.3 * Math.min(H / S, 1.6);
    const stars = [];
    for (let tries = 0; stars.length < n && tries < 500; tries++) {
      const p = { x: rand(-sx, sx), y: rand(-sy, sy) - 0.04 };
      if (stars.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 0.1)) {
        stars.push({ id: stars.length + 1, x: p.x, y: p.y, r: rand(1.4, 3.6), c: Math.floor(Math.random() * TINTS.length) });
      }
    }

    // A minimum spanning tree (Prim's) gives a natural connect-the-dots shape.
    const links = [];
    const joined = [stars[0]];
    const rest = stars.slice(1);
    while (rest.length) {
      let best = null;
      for (const a of joined) {
        for (const b of rest) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (!best || d < best.d) best = { a, b, d };
        }
      }
      links.push([best.a.id, best.b.id]);
      joined.push(best.b);
      rest.splice(rest.indexOf(best.b), 1);
    }

    // Sometimes close a loop so it isn't always a tree.
    if (Math.random() < 0.5) {
      let best = null;
      for (const a of stars) {
        for (const b of stars) {
          if (a.id >= b.id || links.some(([p, q]) => (p === a.id && q === b.id) || (p === b.id && q === a.id))) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (!best || d < best.d) best = { a, b, d };
        }
      }
      if (best) links.push([best.a.id, best.b.id]);
    }

    if (recordUndo) snapshot();
    setState({ galleryId: null, name: randomName(), lore: randomLore(), stars, links }, { animate: true });
  }

  function rerollName() {
    snapshot();
    state.name = randomName();
    state.lore = randomLore();
    syncUI();
  }

  function clearSky() {
    if (!state.stars.length && !state.name) return;
    snapshot();
    setState(freshState());
    ui.hint.classList.remove('dim');
    toast('Sky cleared. Ctrl+Z to undo');
  }

  function syncUI() {
    if (document.activeElement !== ui.name) ui.name.value = state.name;
    ui.lore.textContent = state.lore;
    const n = state.stars.length;
    const l = state.links.length;
    ui.stats.textContent = `${n} ${n === 1 ? 'star' : 'stars'} · ${l} ${l === 1 ? 'line' : 'lines'}`;
  }

  // ---------- gallery (localStorage, with an in-memory fallback) ----------

  let memoryGallery = [];

  function loadGallery() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) memoryGallery = parsed;
    } catch {
      // storage blocked or corrupt: keep the in-memory copy
    }
    return memoryGallery;
  }

  function storeGallery(items) {
    memoryGallery = items;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // storage blocked: gallery lives only for this session
    }
  }

  function save() {
    if (!state.stars.length) return toast('Place a few stars first');
    if (!state.name.trim()) state.name = randomName();
    const items = loadGallery().slice();
    const entry = {
      id: state.galleryId || uid(),
      name: state.name.trim(),
      lore: state.lore,
      stars: clone(state.stars),
      links: clone(state.links),
      savedAt: Date.now(),
    };
    const i = items.findIndex((g) => g.id === entry.id);
    if (i >= 0) items[i] = entry;
    else items.unshift(entry);
    storeGallery(items);
    state.galleryId = entry.id;
    syncUI();
    renderGallery();
    toast(i >= 0 ? `Updated “${entry.name}”` : `Saved “${entry.name}”`);
  }

  function loadEntry(entry) {
    snapshot();
    setState({
      galleryId: entry.id,
      name: entry.name,
      lore: entry.lore,
      stars: clone(entry.stars),
      links: clone(entry.links),
    }, { animate: true });
    toggleGallery(false);
  }

  function deleteEntry(id) {
    const items = loadGallery();
    const item = items.find((g) => g.id === id);
    if (!item || !window.confirm(`Delete “${item.name}” from your gallery?`)) return;
    storeGallery(items.filter((g) => g.id !== id));
    if (state.galleryId === id) state.galleryId = null;
    renderGallery();
  }

  function renderGallery() {
    const items = loadGallery();
    ui.galleryCount.textContent = items.length ? String(items.length) : '';
    ui.galleryList.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing saved yet. Draw a constellation and press Save.';
      ui.galleryList.append(empty);
      return;
    }

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'card' + (item.id === state.galleryId ? ' current' : '');

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'card-open';
      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = item.name;
      const meta = document.createElement('span');
      meta.className = 'card-meta';
      const date = new Date(item.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      meta.textContent = `${item.stars.length} stars · ${date}`;
      open.append(thumbnail(item), name, meta);
      open.addEventListener('click', () => loadEntry(item));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'card-delete';
      del.textContent = '×';
      del.setAttribute('aria-label', `Delete ${item.name}`);
      del.addEventListener('click', () => deleteEntry(item.id));

      li.append(open, del);
      ui.galleryList.append(li);
    }
  }

  function thumbnail(item) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (!item.stars.length) return svg;

    const xs = item.stars.map((s) => s.x);
    const ys = item.stars.map((s) => s.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const size = Math.max(maxX - minX, maxY - minY, 0.1) * 1.3;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    svg.setAttribute('viewBox', `${cx - size / 2} ${cy - size / 2} ${size} ${size}`);

    const stars = new Map(item.stars.map((s) => [s.id, s]));
    for (const [a, b] of item.links) {
      const sa = stars.get(a), sb = stars.get(b);
      if (!sa || !sb) continue;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', sa.x); line.setAttribute('y1', sa.y);
      line.setAttribute('x2', sb.x); line.setAttribute('y2', sb.y);
      svg.append(line);
    }
    for (const s of item.stars) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', s.x); dot.setAttribute('cy', s.y);
      dot.setAttribute('r', size * 0.0065 * s.r);
      svg.append(dot);
    }
    return svg;
  }

  function toggleGallery(open = !ui.gallery.classList.contains('open')) {
    ui.gallery.classList.toggle('open', open);
    ui.gallery.inert = !open;
    ui.galleryBtn.setAttribute('aria-expanded', String(open));
    if (open) renderGallery();
  }

  // ---------- export ----------

  function exportPng() {
    if (!state.stars.length) return toast('Nothing to export yet');
    const keepSelected = selectedId, keepHover = hoverId;
    selectedId = hoverId = null;
    bornAt.clear();
    render(performance.now(), true);
    selectedId = keepSelected;
    hoverId = keepHover;

    const a = document.createElement('a');
    a.download = `${slug(state.name || 'constellation')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('PNG downloaded');
  }

  // ---------- share links ----------
  // The whole constellation is packed into the URL hash as base64url JSON,
  // so a link works without any server.

  function encodeShare() {
    const data = {
      n: state.name.trim(),
      l: state.lore,
      s: state.stars.map((s) => [s.id, +s.x.toFixed(3), +s.y.toFixed(3), +s.r.toFixed(2), s.c || 0]),
      k: state.links,
    };
    let bin = '';
    for (const byte of new TextEncoder().encode(JSON.stringify(data))) bin += String.fromCharCode(byte);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeShare(code) {
    try {
      const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
      const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
      if (!Array.isArray(data.s) || !Array.isArray(data.k)) return null;
      const stars = data.s
        .map(([id, x, y, r, c]) => ({ id, x, y, r: clamp(r, 1, 5), c: TINTS[c] ? c : 0 }))
        .filter((s) => [s.id, s.x, s.y, s.r].every(Number.isFinite));
      if (!stars.length) return null;
      const ids = new Set(stars.map((s) => s.id));
      const links = data.k.filter((l) => Array.isArray(l) && ids.has(l[0]) && ids.has(l[1]));
      return {
        galleryId: null,
        name: String(data.n || '').slice(0, 48),
        lore: String(data.l || randomLore()),
        stars,
        links,
      };
    } catch {
      return null;
    }
  }

  function sharedFromHash() {
    return location.hash.startsWith('#sky=') ? decodeShare(location.hash.slice(5)) : null;
  }

  async function share() {
    if (!state.stars.length) return toast('Place a few stars first');
    const url = `${location.href.split('#')[0]}#sky=${encodeShare()}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch {
      toast('Share link is in the address bar');
    }
  }

  // ---------- toast ----------

  let toastTimer = 0;
  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
  }

  // ---------- background sky ----------

  // A gently curving diagonal band where the "milky way" sits.
  function bandPoint(t) {
    const x0 = -0.1 * W, y0 = 0.95 * H, x1 = 1.1 * W, y1 = 0.05 * H;
    const len = Math.hypot(x1 - x0, y1 - y0);
    return {
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t + Math.sin(t * TAU) * H * 0.06,
      nx: -(y1 - y0) / len,
      ny: (x1 - x0) / len,
    };
  }

  function buildBackground() {
    bgLayer = document.createElement('canvas');
    bgLayer.width = Math.round(W * DPR);
    bgLayer.height = Math.round(H * DPR);
    const g = bgLayer.getContext('2d');
    g.scale(DPR, DPR);

    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#03050d');
    sky.addColorStop(0.55, '#0a1030');
    sky.addColorStop(1, '#1b1742');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    const horizon = g.createRadialGradient(W * 0.5, H * 1.2, 0, W * 0.5, H * 1.2, Math.max(W, H) * 0.75);
    horizon.addColorStop(0, 'rgba(130, 80, 170, 0.35)');
    horizon.addColorStop(1, 'rgba(130, 80, 170, 0)');
    g.fillStyle = horizon;
    g.fillRect(0, 0, W, H);

    g.globalCompositeOperation = 'lighter';
    const span = Math.min(W, H);
    for (let i = 0; i < 80; i++) {
      const b = bandPoint(Math.random());
      const off = gauss() * span * 0.07;
      const x = b.x + b.nx * off, y = b.y + b.ny * off;
      const r = rand(0.05, 0.14) * span;
      const hue = pick(['140,155,255', '185,145,255', '255,195,225']);
      const haze = g.createRadialGradient(x, y, 0, x, y, r);
      haze.addColorStop(0, `rgba(${hue},0.045)`);
      haze.addColorStop(1, `rgba(${hue},0)`);
      g.fillStyle = haze;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  function buildBgStars() {
    const count = Math.min(1100, Math.round((W * H) / 1600));
    const span = Math.min(W, H);
    bgStars = [];
    for (let i = 0; i < count; i++) {
      let x, y;
      if (Math.random() < 0.35) {
        const b = bandPoint(Math.random());
        const off = gauss() * span * 0.09;
        x = b.x + b.nx * off;
        y = b.y + b.ny * off;
      } else {
        x = Math.random() * W;
        y = Math.random() * H;
      }
      const bright = Math.random() < 0.04;
      bgStars.push({
        x, y,
        r: bright ? rand(1, 1.6) : rand(0.3, 0.9),
        a: bright ? rand(0.6, 0.95) : rand(0.15, 0.7),
        speed: rand(0.4, 1.8),
        phase: rand(0, TAU),
        fill: `rgb(${pick(['255,255,255', '255,255,255', '200,215,255', '255,230,200'])})`,
      });
    }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    S = Math.max(1, Math.min(W, H));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    buildBackground();
    buildBgStars();
  }

  // ---------- rendering ----------

  function popOf(star, t) {
    if (reduceMotion) return 1;
    const born = bornAt.get(star.id);
    if (born === undefined) return 1;
    const x = (t - born) / 320;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const c1 = 1.70158, c3 = c1 + 1; // easeOutBack
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function segment(p, q, gapP, gapQ) {
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len <= gapP + gapQ) return;
    const ux = dx / len, uy = dy / len;
    ctx.moveTo(p.x + ux * gapP, p.y + uy * gapP);
    ctx.lineTo(q.x - ux * gapQ, q.y - uy * gapQ);
  }

  function drawBgStars(t) {
    const time = t / 1000;
    for (const s of bgStars) {
      const twinkle = reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(time * s.speed + s.phase);
      ctx.globalAlpha = s.a * twinkle;
      ctx.fillStyle = s.fill;
      if (s.r < 0.8) {
        ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMeteor(t) {
    if (reduceMotion) return;
    if (!meteor) {
      if (t < nextMeteorAt) return;
      const ltr = Math.random() < 0.5;
      const angle = rand(0.25, 0.6);
      const speed = rand(0.9, 1.4) * Math.max(W, H) / 1000; // px per ms
      meteor = {
        x: ltr ? rand(0, W * 0.5) : rand(W * 0.5, W),
        y: rand(0, H * 0.35),
        vx: (ltr ? 1 : -1) * Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: t,
        life: rand(600, 1100),
      };
    }
    const age = t - meteor.born;
    if (age > meteor.life) {
      meteor = null;
      nextMeteorAt = t + rand(5000, 15000);
      return;
    }
    const hx = meteor.x + meteor.vx * age;
    const hy = meteor.y + meteor.vy * age;
    const sp = Math.hypot(meteor.vx, meteor.vy);
    const tx = hx - (meteor.vx / sp) * 130;
    const ty = hy - (meteor.vy / sp) * 130;
    const alpha = Math.sin((age / meteor.life) * Math.PI);
    const trail = ctx.createLinearGradient(hx, hy, tx, ty);
    trail.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
    trail.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = trail;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  function drawLinks(t) {
    const stars = new Map(state.stars.map((s) => [s.id, s]));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(165, 190, 255, 0.6)';
    ctx.shadowColor = 'rgba(140, 170, 255, 0.85)';
    ctx.shadowBlur = 6;
    for (const [a, b] of state.links) {
      const sa = stars.get(a), sb = stars.get(b);
      if (!sa || !sb) continue;
      const k = clamp(Math.min(popOf(sa, t), popOf(sb, t)), 0, 1);
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      ctx.beginPath();
      segment(toPx(sa), toPx(sb), sa.r * 1.5 + 5, sb.r * 1.5 + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDragLine() {
    if (!drag || drag.mode !== 'link' || !drag.moved) return;
    const from = byId(drag.id);
    if (!from) return;
    const target = hoverId != null ? byId(hoverId) : null;
    const unlinking = target && hasLink(from.id, target.id);
    ctx.save();
    ctx.setLineDash(target ? [] : [4, 6]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = unlinking ? 'rgba(255, 140, 140, 0.85)' : 'rgba(255, 214, 140, 0.85)';
    ctx.beginPath();
    segment(toPx(from), target ? toPx(target) : { x: drag.x, y: drag.y }, from.r * 1.5 + 5, target ? target.r * 1.5 + 5 : 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawStars(t) {
    const time = t / 1000;
    for (const s of state.stars) {
      const pop = popOf(s, t);
      if (pop <= 0) continue;
      const p = toPx(s);
      const flicker = reduceMotion ? 1 : 1 + 0.06 * Math.sin(time * 2.1 + s.id * 1.7);
      const r = s.r * flicker * pop;
      const tint = TINTS[s.c || 0];

      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 7);
      glow.addColorStop(0, `rgba(${tint},0.55)`);
      glow.addColorStop(0.25, `rgba(${tint},0.16)`);
      glow.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 7, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();

      if (s.r > 2.8) {
        const L = r * 5;
        ctx.strokeStyle = `rgba(${tint},0.35)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x - L, p.y); ctx.lineTo(p.x + L, p.y);
        ctx.moveTo(p.x, p.y - L); ctx.lineTo(p.x, p.y + L);
        ctx.stroke();
      }

      if (s.id === selectedId || s.id === hoverId) {
        ctx.strokeStyle = s.id === selectedId ? 'rgba(255, 214, 140, 0.9)' : 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, TAU);
        ctx.stroke();
      }
    }
  }

  function drawCaption() {
    const serif = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(236, 232, 255, 0.95)';
    ctx.font = `italic 30px ${serif}`;
    ctx.fillText(state.name.trim() || 'Untitled constellation', 36, H - 60);
    ctx.fillStyle = 'rgba(200, 198, 235, 0.75)';
    ctx.font = `15px ${serif}`;
    ctx.fillText(state.lore, 36, H - 34);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(200, 198, 235, 0.4)';
    ctx.fillText('✦ Starmaker', W - 36, H - 34);
    ctx.restore();
  }

  function render(t, forExport = false) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(bgLayer, 0, 0, W, H);
    drawBgStars(t);
    if (!forExport) drawMeteor(t);
    drawLinks(t);
    if (!forExport) drawDragLine();
    drawStars(t);
    if (forExport) drawCaption();
  }

  function loop(t) {
    render(t);
    requestAnimationFrame(loop);
  }

  // ---------- pointer input ----------
  // Press on empty sky -> new star. Drag from a star -> link to another star
  // (or to a fresh star where you let go). Shift-drag moves. Hold removes.

  function holdRemove(id) {
    if (!drag || drag.moved || drag.id !== id || !byId(id)) return;
    drag = null;
    snapshot();
    removeStar(id);
    syncUI();
    toast('Star removed');
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ui.hint.classList.add('dim');
    const x = e.clientX, y = e.clientY;
    const hit = starAt(x, y);
    canvas.setPointerCapture(e.pointerId);

    if (hit) {
      selectedId = hit.id;
      drag = { mode: e.shiftKey ? 'move' : 'link', id: hit.id, sx: x, sy: y, x, y, moved: false, created: false };
      if (drag.mode === 'link') drag.timer = setTimeout(() => holdRemove(hit.id), HOLD_MS);
    } else {
      snapshot();
      const star = addStar(x, y);
      selectedId = star.id;
      drag = { mode: 'link', id: star.id, sx: x, sy: y, x, y, moved: false, created: true };
      syncUI();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const x = e.clientX, y = e.clientY;
    if (drag) {
      drag.x = x;
      drag.y = y;
      if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > 6) {
        drag.moved = true;
        clearTimeout(drag.timer);
        if (drag.mode === 'move') snapshot();
      }
      if (drag.mode === 'move' && drag.moved) {
        const star = byId(drag.id);
        if (star) Object.assign(star, toUnit(x, y));
      }
    }
    const h = starAt(x, y, drag && drag.mode === 'link' ? drag.id : undefined);
    hoverId = h ? h.id : null;
    canvas.style.cursor = drag && drag.mode === 'move' ? 'grabbing' : h ? 'pointer' : 'crosshair';
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    clearTimeout(drag.timer);
    const d = drag;
    drag = null;
    const x = e.clientX, y = e.clientY;
    if (d.mode !== 'link' || Math.hypot(x - d.sx, y - d.sy) <= HIT || !byId(d.id)) return;
    if (!d.created) snapshot();
    const target = starAt(x, y, d.id) || addStar(x, y);
    toggleLink(d.id, target.id);
    selectedId = target.id;
    syncUI();
  });

  canvas.addEventListener('pointercancel', () => {
    if (drag) clearTimeout(drag.timer);
    drag = null;
  });

  canvas.addEventListener('pointerleave', () => {
    if (!drag) hoverId = null;
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (drag) clearTimeout(drag.timer);
    drag = null;
    const hit = starAt(e.clientX, e.clientY);
    if (!hit) return;
    snapshot();
    removeStar(hit.id);
    syncUI();
  });

  canvas.addEventListener('wheel', (e) => {
    const star = starAt(e.clientX, e.clientY);
    if (!star) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelSnapshot > 700) snapshot();
    lastWheelSnapshot = now;
    star.r = clamp(star.r - Math.sign(e.deltaY) * 0.25, 1, 5);
  }, { passive: false });

  // ---------- controls ----------

  $('btn-random').addEventListener('click', () => randomConstellation());
  $('btn-undo').addEventListener('click', undo);
  $('btn-clear').addEventListener('click', clearSky);
  $('btn-save').addEventListener('click', save);
  $('btn-export').addEventListener('click', exportPng);
  $('btn-share').addEventListener('click', share);
  $('btn-name').addEventListener('click', rerollName);
  ui.galleryBtn.addEventListener('click', () => toggleGallery());
  $('btn-close-gallery').addEventListener('click', () => toggleGallery(false));

  ui.name.addEventListener('input', () => { state.name = ui.name.value; });
  ui.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.name.blur(); });

  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 's') { e.preventDefault(); save(); return; }
    if (mod && key === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape') {
      if (typing) e.target.blur();
      toggleGallery(false);
      selectedId = null;
      return;
    }
    if (typing || mod || e.altKey) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null) {
      snapshot();
      removeStar(selectedId);
      syncUI();
    } else if (key === 'r') {
      randomConstellation();
    } else if (key === 'n') {
      rerollName();
    } else if (key === 'g') {
      toggleGallery();
    } else if (key === 'h') {
      ui.hint.classList.toggle('hidden');
    } else if (key === 'p') {
      exportPng();
    } else if (key === 'l') {
      share();
    }
  });

  window.addEventListener('resize', resize);

  // ---------- start ----------

  resize();
  const shared = sharedFromHash();
  if (shared) setState(shared, { animate: true });
  else randomConstellation(false);

  window.addEventListener('hashchange', () => {
    const next = sharedFromHash();
    if (!next) return;
    snapshot();
    setState(next, { animate: true });
  });
  renderGallery();
  requestAnimationFrame(loop);
})();

/*
 * Encre : écrire au stylet sur n'importe quelle page web.
 *
 * Fonctionnement :
 * - Les traits sont stockés en coordonnées de page (x + scrollX, y + scrollY),
 *   puis redessinés sur un canevas fixe de la taille de la fenêtre. Ils suivent
 *   donc le défilement sans créer un canevas géant.
 * - Le bouton latéral du stylet (bit 2 de PointerEvent.buttons) et le bout
 *   gomme (bit 32) passent en gomme pour la durée du geste. Le clic droit de
 *   la souris aussi.
 * - Les traits sont sauvegardés par adresse de page dans chrome.storage.local.
 */
(() => {
  'use strict';

  // Deuxième injection dans la même page : on alterne afficher / masquer.
  if (window.__encre) {
    window.__encre.toggle();
    return;
  }

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------
  const PEN_COLORS = [
    ['Noir', '#222222'],
    ['Bleu', '#2350D8'],
    ['Rouge', '#D7263D'],
    ['Vert', '#1F8A4C'],
  ];
  const HL_COLORS = [
    ['Jaune', '#FFE14D'],
    ['Vert', '#8AF27A'],
    ['Rose', '#FF8AC8'],
    ['Bleu', '#7FD3FF'],
  ];
  const PEN_SIZES = [2, 3.5, 7];
  const HL_SIZES = [12, 20, 32];
  const ERASER_SIZES = [8, 16, 32]; // rayon, en px
  const SIZE_DOTS = [4, 7, 11];
  const SIZE_NAMES = ['fin', 'moyen', 'épais'];
  const HL_ALPHA = 0.38;
  const ERASE_BITS = 2 | 32; // bouton latéral | bout gomme
  const HISTORY_MAX = 300;

  const KEY_SETTINGS = 'encre:settings';
  const KEY_TRAY = 'encre:tray';
  const TOOLS = ['pen', 'hl', 'eraser', 'nav'];

  const DEFAULT_SETTINGS = {
    tool: 'pen',
    penColor: 1,
    hlColor: 0,
    penSize: 1,
    hlSize: 1,
    eraserSize: 1,
    eraserMode: 'stroke', // 'stroke' = trait entier, 'zone' = seulement la zone touchée
  };

  function pageKey() {
    try {
      const u = new URL(location.href);
      u.hash = '';
      return 'encre:page:' + u.href;
    } catch (_) {
      return 'encre:page:' + location.href.split('#')[0];
    }
  }

  // ---------------------------------------------------------------------------
  // Stockage (tolérant : l'extension peut être rechargée pendant que la page vit)
  // ---------------------------------------------------------------------------
  const store = {
    async get(keys) {
      try {
        return (await chrome.storage.local.get(keys)) || {};
      } catch (_) {
        return {};
      }
    },
    set(obj) {
      try {
        chrome.storage.local.set(obj).catch(() => {});
      } catch (_) {}
    },
    remove(key) {
      try {
        chrome.storage.local.remove(key).catch(() => {});
      } catch (_) {}
    },
  };

  function sendMessage(msg) {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  // ---------------------------------------------------------------------------
  // État
  // ---------------------------------------------------------------------------
  let settings = { ...DEFAULT_SETTINGS };
  const strokes = new Map();
  let nextId = 1;
  let nextZ = 1;
  let sortedCache = null;
  const undoStack = [];
  const redoStack = [];

  let active = false;
  let loaded = false;
  let currentKey = pageKey();
  let session = null; // geste en cours
  let hover = null; // position du curseur à afficher
  let lastPenSeen = 0;
  let trayPos = null;
  let dpr = 1;
  let vw = 0;
  let vh = 0;

  // ---------------------------------------------------------------------------
  // Interface (Shadow DOM pour ne rien hériter de la page)
  // ---------------------------------------------------------------------------
  const host = document.createElement('encre-stylet');
  host.setAttribute(
    'style',
    [
      'all: initial !important',
      'position: fixed !important',
      'inset: 0 !important',
      'display: block !important',
      'z-index: 2147483647 !important',
      'pointer-events: none !important',
    ].join(';')
  );
  const root = host.attachShadow({ mode: 'open' });

  const ICONS = {
    pen: '<path d="M4.5 19.5l1-4.2L15.6 5.2a2.1 2.1 0 0 1 3 0l.2.2a2.1 2.1 0 0 1 0 3L8.7 18.5z"/><path d="M13.8 7l3.2 3.2"/>',
    hl: '<path d="M8.6 12.4l7.2-7.2a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5l-7.2 7.2"/><path d="M8.6 12.4l-1.9 4.7 0.2 0.2 4.7-1.9"/><path d="M6.8 17.2L4.5 19.5"/><path d="M13 20h7"/>',
    eraser:
      '<path d="M9 20h11"/><path d="M4.9 14.4l8.7-8.7a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 19.9H8.4l-3.5-3.5a1.4 1.4 0 0 1 0-2z"/><path d="M9.2 10.1l5.7 5.7"/>',
    nav: '<path d="M6 4.5l12.5 6.1-5.4 1.6-2.4 5.3z"/><path d="M13.1 12.2l4.4 4.4"/>',
    undo: '<path d="M9 14.5L4.5 10 9 5.5"/><path d="M4.5 10H14a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14.5l4.5-4.5L15 5.5"/><path d="M19.5 10H10a5 5 0 0 0 0 10h3"/>',
    clear:
      '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 11.6a1.8 1.8 0 0 0 1.8 1.6h5.6a1.8 1.8 0 0 0 1.8-1.6L17.5 7"/><path d="M10.3 11v5.5M13.7 11v5.5"/>',
    capture:
      '<path d="M4.5 8.5A1.5 1.5 0 0 1 6 7h2l1.6-2.2h4.8L16 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="12.8" r="3.3"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  root.innerHTML = `
<style>
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  canvas { position: fixed; left: 0; top: 0; display: block; }
  .base { pointer-events: none; }
  /* Transparent aux doigts par défaut ; ne capte que si un stylet est proche. */
  .live { pointer-events: none; touch-action: none; cursor: none; }
  .live.capture { pointer-events: auto; }

  .tray {
    --tray: #2B2F36;
    --raised: #363B44;
    --pressed: #3F4550;
    --hair: #464C57;
    --idle: #C3C8D0;
    --ink: #2350D8;
    --on-ink: #FFFFFF;
    position: fixed; left: 16px; top: 120px;
    width: 56px; max-height: calc(100vh - 16px);
    overflow-y: auto; scrollbar-width: none;
    padding: 6px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    background: var(--tray);
    border-radius: 16px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 12px 28px -10px rgba(14, 17, 23, 0.6),
      0 2px 6px rgba(14, 17, 23, 0.28);
    color: var(--idle);
    font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    pointer-events: auto; cursor: default;
    user-select: none; -webkit-user-select: none;
    touch-action: none;
  }
  .tray::-webkit-scrollbar { display: none; }
  .tray.hidden { visibility: hidden; }

  button {
    all: unset; box-sizing: border-box;
    display: grid; place-items: center;
    position: relative; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:focus-visible { outline: 2px solid #9DB4FF; outline-offset: 1px; }

  .grip {
    width: 44px; height: 16px; border-radius: 8px;
    display: grid; place-items: center; cursor: grab; color: #7D8490;
  }
  .grip:hover { color: var(--idle); }
  .grip.dragging { cursor: grabbing; }
  .grip svg { width: 18px; height: 6px; fill: currentColor; }

  .sep { width: 28px; height: 1px; background: var(--hair); margin: 3px 0; flex: none; }

  .btn { width: 40px; height: 40px; border-radius: 12px; color: var(--idle); flex: none; }
  .btn:hover { background: var(--raised); color: #FFFFFF; }
  .btn:disabled { opacity: 0.32; cursor: default; background: none; color: var(--idle); }
  .btn svg {
    position: relative; width: 20px; height: 20px;
    fill: none; stroke: currentColor; stroke-width: 1.8;
    stroke-linecap: round; stroke-linejoin: round;
  }
  /* L'outil actif est posé sur une goutte de l'encre chargée. */
  .tool[aria-pressed="true"], .tool[aria-pressed="true"]:hover { color: var(--on-ink); background: none; }
  .tool[aria-pressed="true"]::before {
    content: ""; position: absolute; inset: 3px;
    background: var(--ink);
    border-radius: 50% 50% 50% 22%;
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.22);
  }

  .ink { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 2px 0; }
  .ink[hidden], .swatches[hidden], .modes[hidden] { display: none; }

  .swatches { display: grid; grid-template-columns: repeat(2, 18px); gap: 7px; padding: 3px 0; }
  .swatch, .swatch:hover {
    width: 18px; height: 18px; border-radius: 50%;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }
  .swatch[aria-checked="true"] {
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 0 0 2px var(--tray), 0 0 0 4px #E6E9EE;
  }

  .modes { display: flex; flex-direction: column; gap: 2px; }
  .mode {
    width: 44px; height: 24px; border-radius: 8px;
    font-size: 11px; color: var(--idle);
  }
  .mode:hover { background: var(--raised); color: #FFFFFF; }
  .mode[aria-checked="true"] { background: var(--pressed); color: #FFFFFF; }

  .sizes { display: flex; gap: 1px; }
  .size { width: 14px; height: 24px; border-radius: 6px; color: var(--dot, var(--idle)); }
  .size:hover { background: var(--raised); }
  .size[aria-checked="true"] { background: var(--pressed); }
  .size i { display: block; width: var(--d); height: var(--d); border-radius: 50%; background: currentColor; }
  .sizes.outline .size i { background: none; border: 1.5px solid currentColor; }

  .toast {
    position: fixed; left: 50%; bottom: 24px;
    transform: translate(-50%, 8px); opacity: 0;
    transition: opacity 0.16s ease, transform 0.16s ease;
    display: flex; align-items: center; gap: 10px;
    padding: 6px 6px 6px 14px; min-height: 40px;
    background: #2B2F36; color: #F2F4F7; border-radius: 12px;
    font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 12px 28px -10px rgba(14, 17, 23, 0.6);
    pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
  .toast span { padding-right: 8px; }
  .toast button { padding: 6px 10px; border-radius: 8px; color: #9DB4FF; font-weight: 600; }
  .toast button:hover { background: #363B44; }
  .toast button[hidden] { display: none; }

  @media (prefers-reduced-motion: reduce) {
    .toast { transition: none; }
  }
</style>
<canvas class="base"></canvas>
<canvas class="live"></canvas>
<div class="tray" role="toolbar" aria-label="Encre" aria-orientation="vertical">
  <button class="grip" title="Déplacer la barre" aria-label="Déplacer la barre">
    <svg viewBox="0 0 18 6" aria-hidden="true"><circle cx="3" cy="1.5" r="1.3"/><circle cx="9" cy="1.5" r="1.3"/><circle cx="15" cy="1.5" r="1.3"/><circle cx="3" cy="4.5" r="1.3"/><circle cx="9" cy="4.5" r="1.3"/><circle cx="15" cy="4.5" r="1.3"/></svg>
  </button>
  <button class="btn tool" data-tool="pen" aria-pressed="false" title="Stylo (P)" aria-label="Stylo">${icon('pen')}</button>
  <button class="btn tool" data-tool="hl" aria-pressed="false" title="Surligneur (S)" aria-label="Surligneur">${icon('hl')}</button>
  <button class="btn tool" data-tool="eraser" aria-pressed="false" title="Gomme (E). Le bouton du stylet efface aussi, quel que soit l'outil." aria-label="Gomme">${icon('eraser')}</button>
  <button class="btn tool" data-tool="nav" aria-pressed="false" title="Naviguer : le stylet et la souris cliquent aussi sur la page (N). Le doigt clique toujours." aria-label="Naviguer">${icon('nav')}</button>
  <div class="ink">
    <div class="sep"></div>
    <div class="swatches" role="radiogroup" aria-label="Couleur"></div>
    <div class="modes" role="radiogroup" aria-label="Type de gomme">
      <button class="mode" data-mode="stroke" role="radio" aria-checked="false" title="Efface tout le trait touché">Trait</button>
      <button class="mode" data-mode="zone" role="radio" aria-checked="false" title="Efface seulement la partie touchée">Zone</button>
    </div>
    <div class="sizes" role="radiogroup" aria-label="Épaisseur"></div>
  </div>
  <div class="sep"></div>
  <button class="btn" data-act="undo" title="Annuler (Ctrl+Z)" aria-label="Annuler">${icon('undo')}</button>
  <button class="btn" data-act="redo" title="Rétablir (Ctrl+Y)" aria-label="Rétablir">${icon('redo')}</button>
  <button class="btn" data-act="clear" title="Tout effacer sur cette page" aria-label="Tout effacer">${icon('clear')}</button>
  <button class="btn" data-act="capture" title="Enregistrer une capture de l'écran annoté" aria-label="Capture">${icon('capture')}</button>
  <button class="btn" data-act="close" title="Masquer l'encre (Échap). Tes traits restent enregistrés." aria-label="Masquer">${icon('close')}</button>
</div>
<div class="toast" role="status" aria-live="polite"><span></span><button type="button" hidden>Annuler</button></div>
`;

  const base = root.querySelector('.base');
  const live = root.querySelector('.live');
  const bctx = base.getContext('2d');
  const lctx = live.getContext('2d');
  const tray = root.querySelector('.tray');
  const grip = root.querySelector('.grip');
  const inkGroup = root.querySelector('.ink');
  const swatchBox = root.querySelector('.swatches');
  const modeBox = root.querySelector('.modes');
  const sizeBox = root.querySelector('.sizes');
  const toastEl = root.querySelector('.toast');
  const toastText = toastEl.querySelector('span');
  const toastBtn = toastEl.querySelector('button');
  const toolBtns = [...root.querySelectorAll('.tool')];
  const actBtn = (name) => root.querySelector(`[data-act="${name}"]`);

  // ---------------------------------------------------------------------------
  // Géométrie des traits
  // ---------------------------------------------------------------------------
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;

  function halfWidthAt(s, pr) {
    return s.t === 'hl' ? s.w / 2 : (s.w * (0.35 + 1.3 * pr)) / 2;
  }
  function maxHalf(s) {
    return s.t === 'hl' ? s.w / 2 : s.w * 0.825;
  }
  function bbox(s) {
    if (s._b) return s._b;
    const p = s.p;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const m = maxHalf(s);
    s._b = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
    return s._b;
  }
  function sorted() {
    if (!sortedCache) sortedCache = [...strokes.values()].sort((a, b) => a.z - b.z || a.id - b.id);
    return sortedCache;
  }
  function addStroke(s) {
    strokes.set(s.id, s);
    sortedCache = null;
  }
  function deleteStroke(id) {
    strokes.delete(id);
    sortedCache = null;
  }

  function drawStroke(ctx, s) {
    const p = s.p;
    const n = p.length / 3;
    if (!n) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;

    if (s.t === 'hl') {
      // Un seul tracé : la transparence ne s'accumule pas sur le même trait.
      ctx.save();
      ctx.globalAlpha = HL_ALPHA;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      if (n === 1) {
        ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(p[0], p[1]);
        for (let i = 1; i < n - 1; i++) {
          const x = p[i * 3], y = p[i * 3 + 1];
          ctx.quadraticCurveTo(x, y, (x + p[i * 3 + 3]) / 2, (y + p[i * 3 + 4]) / 2);
        }
        ctx.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // Stylo : épaisseur variable selon la pression, segment par segment.
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(0.6, halfWidthAt(s, p[2])), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (n === 2) {
      ctx.lineWidth = 2 * halfWidthAt(s, (p[2] + p[5]) / 2);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[3], p[4]);
      ctx.stroke();
      return;
    }
    let mx = (p[0] + p[3]) / 2;
    let my = (p[1] + p[4]) / 2;
    ctx.lineWidth = 2 * halfWidthAt(s, p[2]);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(mx, my);
    ctx.stroke();
    for (let i = 1; i < n - 1; i++) {
      const cx = p[i * 3], cy = p[i * 3 + 1];
      const ex = (cx + p[i * 3 + 3]) / 2;
      const ey = (cy + p[i * 3 + 4]) / 2;
      ctx.lineWidth = 2 * halfWidthAt(s, p[i * 3 + 2]);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();
      mx = ex;
      my = ey;
    }
    const L = (n - 1) * 3;
    ctx.lineWidth = 2 * halfWidthAt(s, p[L + 2]);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(p[L], p[L + 1]);
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------------------
  let raf = 0;
  let baseDirty = false;

  function schedule(baseToo) {
    if (baseToo) baseDirty = true;
    if (!raf && active) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    if (!active) return;
    if (baseDirty) renderBase();
    renderLive();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    vw = host.clientWidth || document.documentElement.clientWidth || window.innerWidth;
    vh = host.clientHeight || window.innerHeight;
    for (const c of [base, live]) {
      c.width = Math.max(1, Math.round(vw * dpr));
      c.height = Math.max(1, Math.round(vh * dpr));
      c.style.width = vw + 'px';
      c.style.height = vh + 'px';
    }
    baseDirty = true;
  }

  function renderBase() {
    baseDirty = false;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, base.width, base.height);
    const sx = window.scrollX, sy = window.scrollY;
    bctx.setTransform(dpr, 0, 0, dpr, -sx * dpr, -sy * dpr);
    const x1 = sx + vw, y1 = sy + vh;
    for (const s of sorted()) {
      const b = bbox(s);
      if (b.x1 < sx || b.x0 > x1 || b.y1 < sy || b.y0 > y1) continue;
      drawStroke(bctx, s);
    }
  }

  function renderLive() {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, live.width, live.height);
    if (session && session.kind === 'draw') {
      lctx.setTransform(dpr, 0, 0, dpr, -window.scrollX * dpr, -window.scrollY * dpr);
      drawStroke(lctx, session.stroke);
    }
    if (!hover || settings.tool === 'nav') return;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.beginPath();
    if (hover.erase) {
      const r = ERASER_SIZES[settings.eraserSize];
      lctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
      lctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      lctx.fill();
      lctx.lineWidth = 2.5;
      lctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      lctx.stroke();
      lctx.lineWidth = 1.2;
      lctx.strokeStyle = 'rgba(30, 33, 39, 0.9)';
      lctx.stroke();
    } else {
      const isHl = settings.tool === 'hl';
      const r = Math.max(1.5, isHl ? HL_SIZES[settings.hlSize] / 2 : PEN_SIZES[settings.penSize] / 2);
      lctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
      lctx.lineWidth = 2;
      lctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      lctx.stroke();
      lctx.globalAlpha = isHl ? 0.6 : 1;
      lctx.fillStyle = currentInk();
      lctx.fill();
      lctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Entrées du stylet
  // ---------------------------------------------------------------------------
  function wantsErase(e) {
    return (e.pointerType === 'pen' || e.pointerType === 'mouse') && (e.buttons & ERASE_BITS) !== 0;
  }
  function inContact(e) {
    if (e.pointerType === 'mouse') return e.buttons !== 0;
    // Bouton latéral maintenu en survol : pas de contact, on affiche juste la gomme.
    return (e.buttons & 1) !== 0 || (e.buttons & 32) !== 0 || e.pressure > 0;
  }
  function eventsOf(e) {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    return list && list.length ? list : [e];
  }
  function currentInk() {
    return settings.tool === 'hl' ? HL_COLORS[settings.hlColor][1] : PEN_COLORS[settings.penColor][1];
  }

  function startDraw(e) {
    const isHl = settings.tool === 'hl';
    const stroke = {
      id: nextId++,
      z: nextZ++,
      t: isHl ? 'hl' : 'pen',
      c: currentInk(),
      w: isHl ? HL_SIZES[settings.hlSize] : PEN_SIZES[settings.penSize],
      p: [],
    };
    session = { kind: 'draw', id: e.pointerId, stroke, pr: null };
    addPoint(e);
  }

  function addPoint(ev) {
    const st = session;
    const x = r1(ev.clientX + window.scrollX);
    const y = r1(ev.clientY + window.scrollY);
    let raw;
    if (ev.pointerType === 'pen') raw = ev.pressure > 0 ? ev.pressure : st.pr == null ? 0.4 : st.pr;
    else raw = 0.5;
    const pr = st.pr == null ? raw : st.pr * 0.55 + raw * 0.45;
    st.pr = pr;
    const p = st.stroke.p;
    const n = p.length;
    if (n >= 3) {
      const dx = x - p[n - 3], dy = y - p[n - 2];
      if (dx * dx + dy * dy < 0.6) {
        p[n - 1] = r2(pr);
        return;
      }
    }
    p.push(x, y, r2(pr));
  }

  function finishDraw() {
    const s = session.stroke;
    session = null;
    if (!s.p.length) return;
    addStroke(s);
    pushHistory({ type: 'add', s });
    changed();
  }

  function startErase(e) {
    session = {
      kind: 'erase',
      id: e.pointerId,
      last: null,
      gesture: { removed: new Map(), added: new Map() },
    };
    eraseFromEvent(e);
  }

  function eraseFromEvent(e) {
    hover = { x: e.clientX, y: e.clientY, erase: true };
    if (!inContact(e)) {
      session.last = null;
      schedule(false);
      return;
    }
    let hit = false;
    for (const ev of eventsOf(e)) {
      if (eraseTo(r1(ev.clientX + window.scrollX), r1(ev.clientY + window.scrollY))) hit = true;
    }
    schedule(hit);
  }

  function eraseTo(x, y) {
    const r = ERASER_SIZES[settings.eraserSize];
    const last = session.last;
    let hit = false;
    if (last) {
      const d = Math.hypot(x - last.x, y - last.y);
      const steps = Math.max(1, Math.ceil(d / (r * 0.5)));
      for (let i = 1; i <= steps; i++) {
        if (eraseCircle(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps, r)) hit = true;
      }
    } else if (eraseCircle(x, y, r)) {
      hit = true;
    }
    session.last = { x, y };
    return hit;
  }

  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }

  function strokeHit(s, x, y, r) {
    const p = s.p;
    const n = p.length / 3;
    if (n === 1) {
      const d = r + halfWidthAt(s, p[2]);
      return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= d * d;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 3, b = a + 3;
      const d = r + Math.max(halfWidthAt(s, p[a + 2]), halfWidthAt(s, p[b + 2]));
      if (segDist2(x, y, p[a], p[a + 1], p[b], p[b + 1]) <= d * d) return true;
    }
    return false;
  }

  // Ajoute des points intermédiaires pour que la gomme « Zone » coupe proprement.
  function resample(p, step) {
    const out = [p[0], p[1], p[2]];
    for (let i = 3; i < p.length; i += 3) {
      const ax = p[i - 3], ay = p[i - 2], ap = p[i - 1];
      const bx = p[i], by = p[i + 1], bp = p[i + 2];
      const k = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
      for (let j = 1; j < k; j++) {
        const t = j / k;
        out.push(r1(ax + (bx - ax) * t), r1(ay + (by - ay) * t), r2(ap + (bp - ap) * t));
      }
      out.push(bx, by, bp);
    }
    return out;
  }

  // Renvoie null si le trait n'est pas touché, sinon la liste des morceaux restants.
  function splitStroke(s, x, y, r) {
    if (s.p.length === 3) return [];
    const p = resample(s.p, Math.max(1, r / 3));
    const frags = [];
    let cur = [];
    let hit = false;
    for (let i = 0; i < p.length; i += 3) {
      const d = r + halfWidthAt(s, p[i + 2]);
      if ((p[i] - x) ** 2 + (p[i + 1] - y) ** 2 <= d * d) {
        hit = true;
        if (cur.length >= 6) frags.push(cur);
        cur = [];
      } else {
        cur.push(p[i], p[i + 1], p[i + 2]);
      }
    }
    if (!hit) return null;
    if (cur.length >= 6) frags.push(cur);
    return frags.map((fp) => ({ id: nextId++, z: s.z, t: s.t, c: s.c, w: s.w, p: fp }));
  }

  function eraseCircle(x, y, r) {
    const g = session.gesture;
    let changedAny = false;
    for (const s of sorted()) {
      const b = bbox(s);
      if (x + r < b.x0 || x - r > b.x1 || y + r < b.y0 || y - r > b.y1) continue;
      if (!strokeHit(s, x, y, r)) continue;
      let frags = [];
      if (settings.eraserMode === 'zone') {
        frags = splitStroke(s, x, y, r);
        if (frags === null) continue;
      }
      deleteStroke(s.id);
      if (g.added.has(s.id)) g.added.delete(s.id);
      else g.removed.set(s.id, s);
      for (const f of frags) {
        addStroke(f);
        g.added.set(f.id, f);
      }
      changedAny = true;
    }
    return changedAny;
  }

  function finishErase() {
    const g = session.gesture;
    session = null;
    if (g.removed.size || g.added.size) {
      pushHistory({ type: 'swap', removed: [...g.removed.values()], added: [...g.added.values()] });
      changed();
    }
  }

  // ---------------------------------------------------------------------------
  // Aiguillage stylet / doigt / souris
  //
  // Le canevas laisse passer les contacts par défaut : le doigt clique, fait
  // défiler et zoome sur la page comme d'habitude. Le canevas ne capte les
  // contacts que lorsqu'un stylet survole l'écran ou pendant un trait. Pendant
  // ce temps, un contact au doigt est pris pour la paume et ignoré.
  //
  // La souris (et un stylet dont le survol n'a pas été vu) est interceptée au
  // niveau de la fenêtre puis redirigée vers le canevas.
  // ---------------------------------------------------------------------------
  const PEN_NEAR_MS = 3000; // délai de secours si Chrome ne signale pas que le stylet s'éloigne
  let penNear = false;
  let penTimer = 0;
  let suppressClickUntil = 0;
  let suppressMenuUntil = 0;

  function updateHitTest() {
    live.classList.toggle('capture', settings.tool !== 'nav' && (penNear || !!session));
  }

  function notePen() {
    lastPenSeen = performance.now();
    clearTimeout(penTimer);
    penTimer = setTimeout(penAway, PEN_NEAR_MS);
    if (!penNear) {
      penNear = true;
      updateHitTest();
    }
  }

  function penAway() {
    clearTimeout(penTimer);
    if (session && session.type === 'pen') {
      penTimer = setTimeout(penAway, 500);
      return;
    }
    penNear = false;
    updateHitTest();
  }

  // Curseur de la page masqué quand la souris écrit (on dessine le nôtre).
  const cursorStyle = document.createElement('style');
  cursorStyle.textContent = '*, *::before, *::after { cursor: none !important; }';
  function setMouseCursor(hidePageCursor) {
    if (cursorStyle.sheet) cursorStyle.sheet.disabled = !hidePageCursor;
  }

  const pathOf = (e) => (typeof e.composedPath === 'function' ? e.composedPath() : [e.target]);
  const onOurUI = (path) => path.includes(tray) || path.includes(toastEl);

  function beginSession(e, redirected) {
    if (session) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    if (wantsErase(e) || settings.tool === 'eraser') startErase(e);
    else startDraw(e);
    session.type = e.pointerType;
    session.redirected = !!redirected;
    updateHitTest();
    try {
      live.setPointerCapture(e.pointerId);
    } catch (_) {}
    schedule(false);
  }

  // --- Événements vus par toute la fenêtre (avant la page) ---

  function onWindowPointerMove(e) {
    if (!active) return;
    if (e.pointerType === 'pen') notePen();
    if (session || e.pointerType === 'touch') return;
    if (settings.tool === 'nav' || onOurUI(pathOf(e))) {
      setMouseCursor(false);
      if (hover) {
        hover = null;
        schedule(false);
      }
      return;
    }
    setMouseCursor(e.pointerType === 'mouse');
    hover = { x: e.clientX, y: e.clientY, erase: wantsErase(e) || settings.tool === 'eraser' };
    schedule(false);
  }

  function onWindowPointerDown(e) {
    if (!active) return;
    if (e.pointerType === 'pen') notePen();
    const path = pathOf(e);
    if (path[0] === live || onOurUI(path)) return; // le canevas ou la barre s'en chargent
    if (e.pointerType === 'touch' || settings.tool === 'nav') return; // la page reçoit le contact
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    // Souris, ou stylet dont le survol n'a pas été vu : la page ne reçoit rien.
    e.stopImmediatePropagation();
    beginSession(e, true);
  }

  function onWindowPointerOut(e) {
    if (!active || e.relatedTarget) return; // relatedTarget nul : le pointeur quitte la fenêtre ou la portée
    if (e.pointerType === 'pen') penAway();
    if (!session && hover) {
      hover = null;
      schedule(false);
    }
  }

  function onWindowClick(e) {
    if (!active) return;
    if (pathOf(e)[0] === live || performance.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onWindowContextMenu(e) {
    if (!active) return;
    if (pathOf(e)[0] === live || session || performance.now() < suppressMenuUntil) e.preventDefault();
  }

  function onWindowDragStart(e) {
    if (active && session) e.preventDefault();
  }

  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerdown', onWindowPointerDown, true);
  window.addEventListener('pointerout', onWindowPointerOut, true);
  window.addEventListener('click', onWindowClick, true);
  window.addEventListener('contextmenu', onWindowContextMenu, true);
  window.addEventListener('dragstart', onWindowDragStart, true);

  // --- Événements reçus par le canevas (stylet proche, ou geste redirigé) ---

  function onCanvasDown(e) {
    if (e.pointerType === 'pen') notePen();
    if (e.pointerType === 'touch') {
      // Stylet à proximité : ce contact vient sans doute de la paume.
      e.preventDefault();
      // Le stylet n'a plus bougé depuis un moment : on rend la main aux doigts.
      if (!session && performance.now() - lastPenSeen > 1200) penAway();
      return;
    }
    beginSession(e, false);
  }

  function onCanvasMove(e) {
    if (!session || e.pointerId !== session.id) return;

    if (session.kind === 'draw') {
      if (wantsErase(e)) {
        // Bouton du stylet pressé en plein trait : on garde le début, puis on gomme.
        const { type, redirected } = session;
        finishDraw();
        startErase(e);
        session.type = type;
        session.redirected = redirected;
        return;
      }
      for (const ev of eventsOf(e)) addPoint(ev);
      hover = { x: e.clientX, y: e.clientY, erase: false };
      schedule(false);
      return;
    }

    if (session.kind === 'erase') eraseFromEvent(e);
  }

  function onCanvasUp(e) {
    if (!session || e.pointerId !== session.id) return;
    const { kind, type, redirected } = session;
    if (kind === 'draw') finishDraw();
    else finishErase();
    session = null;
    const now = performance.now();
    if (redirected) suppressClickUntil = now + 300;
    if (kind === 'erase' || type === 'mouse') suppressMenuUntil = now + 600;
    if (hover) hover.erase = settings.tool === 'eraser';
    updateHitTest();
    schedule(false);
  }

  live.addEventListener('pointerdown', onCanvasDown);
  live.addEventListener('pointermove', onCanvasMove);
  live.addEventListener('pointerup', onCanvasUp);
  live.addEventListener('pointercancel', onCanvasUp);
  live.addEventListener('lostpointercapture', (e) => {
    if (session && e.pointerId === session.id) onCanvasUp(e);
  });

  // ---------------------------------------------------------------------------
  // Historique
  // ---------------------------------------------------------------------------
  function pushHistory(action) {
    undoStack.push(action);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  function applyAction(a, reverse) {
    if (a.type === 'add') {
      if (reverse) deleteStroke(a.s.id);
      else addStroke(a.s);
      return;
    }
    const out = reverse ? a.added : a.removed;
    const inn = reverse ? a.removed : a.added;
    out.forEach((s) => deleteStroke(s.id));
    inn.forEach((s) => addStroke(s));
  }
  function undo() {
    if (session) return;
    const a = undoStack.pop();
    if (!a) return;
    applyAction(a, true);
    redoStack.push(a);
    changed();
  }
  function redo() {
    if (session) return;
    const a = redoStack.pop();
    if (!a) return;
    applyAction(a, false);
    undoStack.push(a);
    changed();
  }
  function clearAll() {
    if (!strokes.size) return;
    pushHistory({ type: 'swap', removed: [...strokes.values()], added: [] });
    strokes.clear();
    sortedCache = null;
    changed();
    toast('Tout effacé', 'Annuler', undo);
  }

  function changed() {
    schedule(true);
    save();
    syncUI();
  }

  // ---------------------------------------------------------------------------
  // Sauvegarde par page
  // ---------------------------------------------------------------------------
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!loaded) return;
    if (!strokes.size) {
      store.remove(currentKey);
      return;
    }
    store.set({
      [currentKey]: {
        v: 1,
        s: sorted().map((s) => [s.t === 'hl' ? 1 : 0, s.c, s.w, s.z, s.p]),
      },
    });
  }
  function loadStrokes(data) {
    strokes.clear();
    sortedCache = null;
    undoStack.length = 0;
    redoStack.length = 0;
    nextZ = 1;
    if (!data || data.v !== 1 || !Array.isArray(data.s)) return;
    for (const row of data.s) {
      const [t, c, w, z, p] = row;
      if (!Array.isArray(p) || p.length < 3) continue;
      const s = { id: nextId++, z: +z || nextZ, t: t ? 'hl' : 'pen', c: String(c), w: +w || 3, p };
      strokes.set(s.id, s);
      if (s.z >= nextZ) nextZ = s.z + 1;
    }
  }
  function saveSettings() {
    store.set({ [KEY_SETTINGS]: settings });
  }

  // Sites à navigation interne (l'adresse change sans rechargement).
  let urlTimer = 0;
  async function checkUrl() {
    if (!host.isConnected && active) document.documentElement.appendChild(host);
    const key = pageKey();
    if (key === currentKey) return;
    flush();
    currentKey = key;
    loaded = false;
    const got = await store.get([key]);
    loadStrokes(got[key]);
    loaded = true;
    changed();
  }

  // ---------------------------------------------------------------------------
  // Barre d'outils
  // ---------------------------------------------------------------------------
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function syncUI() {
    const tool = settings.tool;
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));

    const drawing = tool === 'pen' || tool === 'hl';
    const ink = drawing ? currentInk() : '#4A505B';
    tray.style.setProperty('--ink', ink);
    tray.style.setProperty('--on-ink', luminance(ink) > 0.45 ? '#1E2127' : '#FFFFFF');

    updateHitTest();
    if (tool === 'nav') setMouseCursor(false);
    inkGroup.hidden = tool === 'nav';
    swatchBox.hidden = !drawing;
    modeBox.hidden = tool !== 'eraser';

    if (drawing) {
      const colors = tool === 'hl' ? HL_COLORS : PEN_COLORS;
      const sel = tool === 'hl' ? settings.hlColor : settings.penColor;
      swatchBox.innerHTML = colors
        .map(
          ([name, v], i) =>
            `<button class="swatch" role="radio" data-color="${i}" aria-checked="${i === sel}" style="--c:${v}" title="${name}" aria-label="${name}"></button>`
        )
        .join('');
    }
    for (const b of modeBox.querySelectorAll('.mode')) {
      b.setAttribute('aria-checked', String(b.dataset.mode === settings.eraserMode));
    }

    const sizeSel = tool === 'hl' ? settings.hlSize : tool === 'eraser' ? settings.eraserSize : settings.penSize;
    const what = tool === 'eraser' ? 'Gomme' : 'Trait';
    sizeBox.classList.toggle('outline', tool === 'eraser');
    sizeBox.style.setProperty('--dot', tool === 'eraser' ? '#C3C8D0' : tool === 'hl' ? currentInk() : '#E6E9EE');
    sizeBox.innerHTML = SIZE_DOTS.map(
      (d, i) =>
        `<button class="size" role="radio" data-size="${i}" aria-checked="${i === sizeSel}" title="${what} ${SIZE_NAMES[i]}" aria-label="${what} ${SIZE_NAMES[i]}" style="--d:${d}px"><i></i></button>`
    ).join('');

    actBtn('undo').disabled = !undoStack.length;
    actBtn('redo').disabled = !redoStack.length;
    actBtn('clear').disabled = !strokes.size;
  }

  function setTool(tool) {
    if (!TOOLS.includes(tool)) return;
    settings.tool = tool;
    if (tool === 'nav') hover = null;
    saveSettings();
    syncUI();
    schedule(false);
  }

  tray.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !tray.contains(b)) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.color != null) {
      if (settings.tool === 'hl') settings.hlColor = +b.dataset.color;
      else settings.penColor = +b.dataset.color;
      saveSettings();
      syncUI();
    } else if (b.dataset.size != null) {
      const v = +b.dataset.size;
      if (settings.tool === 'hl') settings.hlSize = v;
      else if (settings.tool === 'eraser') settings.eraserSize = v;
      else settings.penSize = v;
      saveSettings();
      syncUI();
    } else if (b.dataset.mode) {
      settings.eraserMode = b.dataset.mode;
      saveSettings();
      syncUI();
    } else if (b.dataset.act === 'undo') undo();
    else if (b.dataset.act === 'redo') redo();
    else if (b.dataset.act === 'clear') clearAll();
    else if (b.dataset.act === 'capture') capture();
    else if (b.dataset.act === 'close') hide();
  });

  // Déplacer la barre par sa poignée.
  let drag = null;
  function placeTray(x, y) {
    const r = tray.getBoundingClientRect();
    const maxX = Math.max(8, vw - r.width - 8);
    const maxY = Math.max(8, vh - r.height - 8);
    x = Math.min(Math.max(8, x), maxX);
    y = Math.min(Math.max(8, y), maxY);
    trayPos = { x: Math.round(x), y: Math.round(y) };
    tray.style.left = trayPos.x + 'px';
    tray.style.top = trayPos.y + 'px';
  }
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = tray.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) placeTray(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    grip.classList.remove('dragging');
    store.set({ [KEY_TRAY]: trayPos });
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);

  // Message bref en bas de l'écran.
  let toastTimer = 0;
  let toastAction = null;
  function toast(text, actionLabel, action) {
    toastText.textContent = text;
    toastAction = action || null;
    toastBtn.hidden = !action;
    if (actionLabel) toastBtn.textContent = actionLabel;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), action ? 5000 : 2800);
  }
  toastBtn.addEventListener('click', () => {
    toastEl.classList.remove('show');
    if (toastAction) toastAction();
    toastAction = null;
  });

  // Capture de l'écran annoté (sans la barre).
  const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
  async function capture() {
    tray.classList.add('hidden');
    toastEl.classList.remove('show');
    hover = null;
    renderLive();
    await nextFrame();
    await nextFrame();
    let res = null;
    try {
      res = await sendMessage({ type: 'encre:capture' });
    } catch (_) {}
    tray.classList.remove('hidden');
    if (!res || !res.ok) {
      toast("La capture n'a pas fonctionné sur cette page");
      return;
    }
    const b64 = res.dataUrl.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `encre-${location.hostname || 'page'}-${stamp}.png`;
    a.style.display = 'none';
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Capture enregistrée dans tes téléchargements');
  }

  // ---------------------------------------------------------------------------
  // Clavier
  // ---------------------------------------------------------------------------
  function isEditable(el) {
    if (!el || el === host) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  window.addEventListener(
    'keydown',
    (e) => {
      // En mode Naviguer, le clavier reste entièrement à la page.
      if (!active || settings.tool === 'nav' || isEditable(e.target)) return;
      const k = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && !e.altKey && k === 'z') {
        stop();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && !e.altKey && k === 'y') {
        stop();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      if (k === 'escape') {
        stop();
        hide();
        return;
      }
      const map = { p: 'pen', s: 'hl', e: 'eraser', n: 'nav' };
      if (map[k]) {
        stop();
        setTool(map[k]);
      }
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Fenêtre
  // ---------------------------------------------------------------------------
  window.addEventListener('scroll', () => active && schedule(true), { passive: true });
  window.addEventListener('resize', () => {
    if (!active) return;
    resize();
    if (trayPos) placeTray(trayPos.x, trayPos.y);
    schedule(true);
  });
  window.addEventListener('pagehide', () => active && flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && active) flush();
  });

  // ---------------------------------------------------------------------------
  // Afficher / masquer
  // ---------------------------------------------------------------------------
  async function show() {
    active = true;
    document.documentElement.appendChild(host);
    (document.head || document.documentElement).appendChild(cursorStyle);
    setMouseCursor(false);
    resize();
    if (!loaded) {
      currentKey = pageKey();
      const got = await store.get([KEY_SETTINGS, KEY_TRAY, currentKey]);
      settings = { ...DEFAULT_SETTINGS, ...(got[KEY_SETTINGS] || {}) };
      if (!TOOLS.includes(settings.tool)) settings.tool = 'pen';
      trayPos = got[KEY_TRAY] || null;
      loadStrokes(got[currentKey]);
      loaded = true;
    } else {
      await checkUrl(); // l'adresse a pu changer pendant que l'encre était masquée
    }
    syncUI();
    if (trayPos) placeTray(trayPos.x, trayPos.y);
    else placeTray(16, (vh - tray.getBoundingClientRect().height) / 2);
    schedule(true);
    clearInterval(urlTimer);
    urlTimer = setInterval(checkUrl, 800);
    sendMessage({ type: 'encre:state', active: true });
  }

  function hide() {
    flush();
    active = false;
    session = null;
    hover = null;
    penNear = false;
    clearTimeout(penTimer);
    clearInterval(urlTimer);
    toastEl.classList.remove('show');
    cursorStyle.remove();
    host.remove();
    sendMessage({ type: 'encre:state', active: false });
  }

  window.__encre = {
    toggle() {
      if (active) hide();
      else show();
    },
  };

  show();
})();

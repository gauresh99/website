/**
 * Project artwork.
 *
 * Generated SVG rather than photographs. Three reasons, in order of weight:
 * the CSP forbids fetching anything from another origin, so a stock image
 * would have to be downloaded and committed; a downloaded image carries a
 * licence question that a portfolio really does not want; and a drawing can
 * take its colours from the page's own tokens, so it works in light and dark
 * without a second asset.
 *
 * Each returns an inline <svg>. `currentColor` inherits from the container, so
 * one drawing serves both themes.
 */

const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox, build) {
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  build(node);
  return node;
}

function add(parent, tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
  parent.append(el);
  return el;
}

/* A BLDC motor wired to its driver board. */
function motor(s) {
  add(s, 'circle', { cx: 30, cy: 32, r: 15 });
  add(s, 'circle', { cx: 30, cy: 32, r: 5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(s, 'line', {
      x1: 30 + Math.cos(a) * 7, y1: 32 + Math.sin(a) * 7,
      x2: 30 + Math.cos(a) * 14, y2: 32 + Math.sin(a) * 14,
    });
  }
  add(s, 'rect', { x: 62, y: 18, width: 30, height: 28, rx: 3 });
  for (let i = 0; i < 4; i++) {
    add(s, 'line', { x1: 62, y1: 24 + i * 6, x2: 56, y2: 24 + i * 6 });
    add(s, 'line', { x1: 92, y1: 24 + i * 6, x2: 98, y2: 24 + i * 6 });
  }
  add(s, 'path', { d: 'M45 32 H56' });
  add(s, 'path', { d: 'M70 52 v8 M78 52 v8 M86 52 v8' });
}

/* A powered wheelchair. */
function wheelchair(s) {
  add(s, 'circle', { cx: 42, cy: 46, r: 14 });
  add(s, 'circle', { cx: 42, cy: 46, r: 4 });
  add(s, 'circle', { cx: 70, cy: 54, r: 6 });
  add(s, 'path', { d: 'M34 30 h20 l6 16' });
  add(s, 'path', { d: 'M40 30 v-8 h14' });
  add(s, 'path', { d: 'M54 46 h14' });
  add(s, 'circle', { cx: 78, cy: 22, r: 5 });
  add(s, 'path', { d: 'M78 27 v8' });
}

/* A screen with a waveform: the interview scorer listening. */
function interview(s) {
  add(s, 'rect', { x: 18, y: 16, width: 64, height: 40, rx: 4 });
  add(s, 'path', { d: 'M40 56 v6 h20 v-6' });
  add(s, 'path', { d: 'M28 36 l6 -10 l6 20 l6 -24 l6 18 l6 -8 l6 4' });
  add(s, 'circle', { cx: 92, cy: 30, r: 6 });
  add(s, 'path', { d: 'M92 36 v6' });
}

/* A receipt with a clock: what expires next. */
function receipt(s) {
  add(s, 'path', { d: 'M28 12 h36 v48 l-6 -4 l-6 4 l-6 -4 l-6 4 l-6 -4 l-6 4 z' });
  add(s, 'path', { d: 'M36 24 h20 M36 32 h20 M36 40 h12' });
  add(s, 'circle', { cx: 78, cy: 44, r: 14 });
  add(s, 'path', { d: 'M78 36 v8 l6 4' });
}

/* A chip die with pins: the processor. */
function chip(s) {
  add(s, 'rect', { x: 32, y: 20, width: 36, height: 36, rx: 3 });
  add(s, 'rect', { x: 42, y: 30, width: 16, height: 16, rx: 2 });
  for (let i = 0; i < 3; i++) {
    const o = 26 + i * 10;
    add(s, 'line', { x1: 32, y1: o, x2: 22, y2: o });
    add(s, 'line', { x1: 68, y1: o, x2: 78, y2: o });
    add(s, 'line', { x1: o + 6, y1: 20, x2: o + 6, y2: 12 });
    add(s, 'line', { x1: o + 6, y1: 56, x2: o + 6, y2: 64 });
  }
}

/* An arcade cabinet: the air-hockey game. */
function arcade(s) {
  add(s, 'rect', { x: 30, y: 12, width: 40, height: 52, rx: 4 });
  add(s, 'rect', { x: 36, y: 18, width: 28, height: 20, rx: 2 });
  add(s, 'circle', { cx: 44, cy: 48, r: 4 });
  add(s, 'circle', { cx: 56, cy: 48, r: 4 });
  add(s, 'path', { d: 'M40 28 h8 M52 24 v8 M48 28 h8' });
  add(s, 'circle', { cx: 82, cy: 30, r: 8 });
  add(s, 'path', { d: 'M82 22 v16 M74 30 h16' });
}

/* Stacked layers: kernel, filesystem, cache. */
function os(s) {
  for (let i = 0; i < 3; i++) {
    add(s, 'rect', { x: 26, y: 16 + i * 16, width: 48, height: 12, rx: 2 });
    add(s, 'circle', { cx: 34, cy: 22 + i * 16, r: 2 });
  }
  add(s, 'path', { d: 'M82 22 h8 v40 h-8' });
  add(s, 'path', { d: 'M86 42 h-12' });
}

/* A hanging garment: the wardrobe app. */
function wardrobe(s) {
  add(s, 'path', { d: 'M50 16 a6 6 0 1 1 6 6 v4' });
  add(s, 'path', { d: 'M56 26 L30 44 v18 h52 V44 z' });
  add(s, 'path', { d: 'M44 34 v28 M68 34 v28' });
}

/* A brain over a chip: the neurotechnology lab. */
function brainchip(s) {
  add(s, 'path', { d: 'M40 34 a10 10 0 0 1 4 -18 a9 9 0 0 1 14 -2 a9 9 0 0 1 14 4 a10 10 0 0 1 2 16' });
  add(s, 'path', { d: 'M44 34 q8 -6 14 0 q8 -6 14 0' });
  add(s, 'rect', { x: 40, y: 38, width: 32, height: 20, rx: 3 });
  for (let i = 0; i < 3; i++) {
    add(s, 'line', { x1: 40, y1: 44 + i * 6, x2: 32, y2: 44 + i * 6 });
    add(s, 'line', { x1: 72, y1: 44 + i * 6, x2: 80, y2: 44 + i * 6 });
  }
}

const ART = { motor, wheelchair, interview, receipt, chip, arcade, os, wardrobe, brainchip };

/** @returns {SVGElement|null} */
export function projectArt(key) {
  const build = ART[String(key || '')];
  return build ? svg('0 0 110 76', build) : null;
}

export const ART_KEYS = Object.keys(ART);

/**
 * A footballer with a squad number on the shirt and a ball at his feet.
 *
 * Shared by the hero widget and the in-game reveal so there is one figure to
 * maintain rather than two that drift. The kick and the ball are driven by CSS
 * classes, which is where the prefers-reduced-motion guard lives.
 *
 * @param {string|number} numberText shirt number, or '' for a blank shirt
 */
export function playerFigure(numberText) {
  const s = svg('0 0 120 150', (node) => {
    add(node, 'ellipse', { cx: 60, cy: 140, rx: 32, ry: 5, fill: 'rgba(0,0,0,0.16)', stroke: 'none' });

    // Standing leg, then the kicking leg which carries the animation class.
    add(node, 'path', {
      d: 'M54 96 L49 130', stroke: 'currentColor', 'stroke-width': 9, 'stroke-linecap': 'round',
    });
    add(node, 'path', {
      d: 'M66 96 L84 120', stroke: 'currentColor', 'stroke-width': 9,
      'stroke-linecap': 'round', class: 'gm-player__leg-kick',
    });

    // Shirt and arms.
    const kit = 'var(--player-kit, #ff3d71)';
    add(node, 'rect', { x: 37, y: 42, width: 46, height: 56, rx: 13, fill: kit, stroke: 'none' });
    add(node, 'path', { d: 'M37 54 L20 70', stroke: kit, 'stroke-width': 9, 'stroke-linecap': 'round' });
    add(node, 'path', { d: 'M83 54 L100 44', stroke: kit, 'stroke-width': 9, 'stroke-linecap': 'round' });

    const label = String(numberText === null || numberText === undefined ? '' : numberText);
    if (label) {
      // The shirt is 46 units wide. A fixed size fits three digits and spills
      // past the sleeves on four, so the size steps down with the digit count
      // and textLength caps it regardless — belt and braces, because the number
      // is random and four digits is the common case.
      const fit = 38;
      const size = label.length >= 4 ? 17 : (label.length === 3 ? 21 : 24);
      const t = add(node, 'text', {
        x: 60, y: 76, 'text-anchor': 'middle', fill: '#fff', stroke: 'none',
        'font-size': size, 'font-weight': 800,
        textLength: fit, lengthAdjust: 'spacingAndGlyphs',
        'font-family': 'ui-monospace, Menlo, Consolas, monospace',
      });
      t.textContent = label;
    }

    add(node, 'circle', { cx: 60, cy: 27, r: 14, fill: 'currentColor', stroke: 'none' });

    const ball = add(node, 'g', { class: 'gm-player__ball' });
    add(ball, 'circle', { cx: 94, cy: 126, r: 11, fill: '#fff', stroke: '#1d2b24', 'stroke-width': 2 });
    add(ball, 'path', { d: 'M94 117 l6 5 -3 7 -6 0 -3 -7 z', fill: '#1d2b24', stroke: 'none' });
  });
  s.setAttribute('stroke-width', '2');
  return s;
}

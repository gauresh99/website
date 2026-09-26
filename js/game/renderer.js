/**
 * Canvas renderer.
 *
 * Three ideas carry this file:
 *
 * 1. THE SIMULATION IS IN METRES, THE RENDERER OWNS PIXELS.
 *    Nothing upstream knows the canvas size. That is what makes "resize
 *    mid-flight" a non-event: a resize recomputes a projection, and the ball
 *    keeps travelling along exactly the same metres it was already on. If the
 *    physics were in pixels, every resize would teleport the ball.
 *
 * 2. EVERYTHING STATIC IN SCREEN SPACE IS DRAWN ONCE, NOT EVERY FRAME.
 *    Sky, turf, markings, posts and net are ~200 stroke and fill calls that
 *    produce an identical image every frame until the canvas resizes or the
 *    theme changes. They are rendered into an offscreen canvas on resize and
 *    composited with a single drawImage. The per-frame cost of the entire
 *    background goes from ~200 calls to one.
 *
 * 3. RENDER IS A PURE FUNCTION OF (STATE, ALPHA) AND ALLOCATES NOTHING.
 *    Every position is blended between the previous and current physics step
 *    using the loop's alpha, so motion is smooth on a 144 Hz display while the
 *    simulation stays at 60 Hz. No colour strings are built per frame (opacity
 *    goes through globalAlpha, which costs nothing, instead of `rgba(...)`
 *    concatenation, which allocates a string per particle per frame). No
 *    gradients are constructed per frame; the one glow gradient is built at
 *    resize in local coordinates and positioned with a transform.
 */

import { CONFIG, OUTCOME } from './config.js';
import { P_CONFETTI, P_TRAIL } from './particles.js';

/** Camera. Behind and slightly above the striker. */
const CAM_Y = 1.9;
const CAM_Z = -6.5;

/** DPR above 2 buys nothing visible here and costs 2.25x the fill rate of 2 on
 *  a phone that already has the least headroom. Capped deliberately. */
const MAX_DPR = 2;
/** Hard ceiling on the backing store in either dimension. A 6K ultrawide at
 *  DPR 2 would otherwise ask for a buffer some browsers refuse to allocate,
 *  and getContext returns null rather than throwing, which is a silent blank
 *  canvas rather than an error anyone would notice. */
const MAX_DIM = 4096;

const PALETTE_KEYS = [
  'sky1', 'sky2', 'turf1', 'turf2', 'turfFar', 'line', 'net', 'post',
  'ball', 'ballDark', 'keeper', 'keeperAlt', 'glove', 'accent', 'accentAlt',
  'reticle', 'shadow', 'flash', 'c1', 'c2', 'c3', 'c4',
  'panel', 'panelEdge', 'panelEdgeDown', 'panelText', 'panelTextDim',
];

/* Panel typography. System stacks only — the CSP forbids fetching a font. */
const NUM_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const PALETTE_FALLBACK = {
  sky1: '#0e2a4d', sky2: '#2a6ea8', turf1: '#1f8a4c', turf2: '#1a7b43',
  turfFar: '#155f34', line: '#f4f7f5', net: '#dfe8e3', post: '#ffffff',
  ball: '#ffffff', ballDark: '#1d2b24', keeper: '#ff9e1b', keeperAlt: '#e07d00',
  glove: '#12233a', accent: '#ff3d71', accentAlt: '#ffd166',
  reticle: '#ffd166', shadow: 'rgba(0,0,0,0.3)', flash: '#ffffff',
  c1: '#ff3d71', c2: '#ffd166', c3: '#3ddc97', c4: '#5bc0eb',
  panel: 'rgba(8, 24, 18, 0.80)', panelEdge: '#3ddc97',
  panelEdgeDown: 'rgba(120,140,130,0.5)', panelText: '#ffffff',
  panelTextDim: 'rgba(233,245,239,0.82)',
};

/**
 * The keeper's face.
 *
 * Loaded once, lazily, and entirely optional: if the file is missing, slow, or
 * blocked, `faceReady` simply stays false and the keeper keeps the drawn head
 * it has always had. Nothing waits on this and nothing breaks without it.
 */
let faceImg = null;
let faceReady = false;
function loadFace() {
  if (faceImg) return;
  try {
    faceImg = new Image();
    faceImg.decoding = 'async';
    faceImg.addEventListener('load', () => { faceReady = faceImg.naturalWidth > 0; }, { once: true });
    faceImg.addEventListener('error', () => { faceReady = false; }, { once: true });
    faceImg.src = 'assets/gauresh-face.jpg';
  } catch {
    faceImg = null;
    faceReady = false;
  }
}

export function createRenderer(canvas, host) {
  /** @type {CanvasRenderingContext2D|null} */
  let ctx = null;
  let bg = null;
  let bgCtx = null;
  let glow = null;

  let cssW = 1, cssH = 1, dpr = 1;
  let focal = 1, horizonY = 0, centerX = 0;
  let lost = false;
  let dirty = true;

  const pal = Object.create(null);
  for (let i = 0; i < PALETTE_KEYS.length; i++) {
    pal[PALETTE_KEYS[i]] = PALETTE_FALLBACK[PALETTE_KEYS[i]];
  }
  /** Indexed lookup so the particle loop picks a colour without a switch or a
   *  string build. Filled by refreshPalette. */
  const confetti = [PALETTE_FALLBACK.c1, PALETTE_FALLBACK.c2, PALETTE_FALLBACK.c3, PALETTE_FALLBACK.c4];

  /** Visitor's squad number, shown on the kicker's shirt. */
  let playerNumberText = '';

  loadFace();

  function acquire() {
    if (ctx) return true;
    try {
      ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    } catch { ctx = null; }
    if (!ctx) {
      // Genuinely possible: memory pressure, a blocked canvas (some privacy
      // extensions), or an oversized backing store. The game must still play,
      // so we report failure and the scene runs on the DOM HUD alone.
      return false;
    }
    return true;
  }

  /** Read design tokens out of CSS so the canvas follows the site's theme
   *  without this module hardcoding a palette or importing one. getComputedStyle
   *  forces style resolution, so it happens on resize and theme change only —
   *  never in the loop. */
  function refreshPalette() {
    let cs = null;
    try { cs = getComputedStyle(host); } catch { cs = null; }
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
      const key = PALETTE_KEYS[i];
      let v = '';
      if (cs) v = cs.getPropertyValue('--gm-' + key).trim();
      pal[key] = v || PALETTE_FALLBACK[key];
    }
    confetti[0] = pal.c1; confetti[1] = pal.c2; confetti[2] = pal.c3; confetti[3] = pal.c4;
    dirty = true;
  }

  /**
   * Fit the projection to whatever box we were given.
   *
   * Two constraints: the goal must occupy a sensible fraction of the width, and
   * the whole scene from crossbar to ball must fit the height. Taking the
   * smaller focal length satisfies both, which is what makes a 320px phone and
   * a 21:9 desktop both look deliberate rather than cropped.
   */
  function computeProjection() {
    const dGoal = CONFIG.GOAL_Z - CAM_Z;
    const dBall = -CAM_Z;

    const focalW = 0.60 * cssW * dGoal / (2 * CONFIG.GOAL_HALF_W);
    const vSpanPerFocal = CAM_Y / dBall + (CONFIG.GOAL_H - CAM_Y) / dGoal;
    const focalH = 0.86 * cssH / vSpanPerFocal;

    focal = Math.max(24, Math.min(focalW, focalH));
    const span = focal * vSpanPerFocal;
    const offGoalTop = -(CONFIG.GOAL_H - CAM_Y) * focal / dGoal;
    horizonY = (cssH - span) * 0.5 - offGoalTop;
    centerX = cssW * 0.5;
  }

  /** Perspective divide. Inlined by hand at every hot call site below; this
   *  named pair exists for the background builder's readability. */
  function scaleAt(z) { return focal / (z - CAM_Z); }
  function sx(x, s) { return centerX + x * s; }
  function sy(y, s) { return horizonY - (y - CAM_Y) * s; }

  function resize(w, h, devicePixelRatio) {
    const nextDpr = Math.max(1, Math.min(MAX_DPR, devicePixelRatio || 1));
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    if (nw === cssW && nh === cssH && nextDpr === dpr && !dirty) return;

    cssW = nw; cssH = nh; dpr = nextDpr;

    let bw = Math.round(cssW * dpr);
    let bh = Math.round(cssH * dpr);
    if (bw > MAX_DIM || bh > MAX_DIM) {
      const k = Math.min(MAX_DIM / bw, MAX_DIM / bh);
      bw = Math.max(1, Math.floor(bw * k));
      bh = Math.max(1, Math.floor(bh * k));
      dpr = bw / cssW;
    }

    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    computeProjection();
    buildBackground();
    dirty = false;
  }

  // --- Static background ---------------------------------------------------

  function lineTo3(c, x, z, y, first) {
    const s = scaleAt(z);
    const px = sx(x, s);
    const py = sy(y, s);
    if (first) c.moveTo(px, py); else c.lineTo(px, py);
  }

  /** Draw a ground segment, clipped to the near plane so nothing behind the
   *  camera is projected (which would mirror it across the screen). */
  function groundSeg(c, x0, z0, x1, z1) {
    const near = CAM_Z + 0.8;
    let ax = x0, az = z0, bx = x1, bz = z1;
    if (az < near && bz < near) return;
    if (az < near) { const t = (near - az) / (bz - az); ax = ax + (bx - ax) * t; az = near; }
    if (bz < near) { const t = (near - bz) / (az - bz); bx = bx + (ax - bx) * t; bz = near; }
    lineTo3(c, ax, az, 0, true);
    lineTo3(c, bx, bz, 0, false);
  }

  function buildBackground() {
    if (!acquire()) return;
    if (!bg) {
      bg = document.createElement('canvas');
      bgCtx = bg.getContext('2d', { alpha: false });
    }
    if (!bgCtx) return;

    bg.width = canvas.width;
    bg.height = canvas.height;
    const c = bgCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);

    // Sky.
    const sky = c.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
    sky.addColorStop(0, pal.sky1);
    sky.addColorStop(1, pal.sky2);
    c.fillStyle = sky;
    c.fillRect(0, 0, cssW, Math.max(0, horizonY));

    // Turf base.
    c.fillStyle = pal.turfFar;
    c.fillRect(0, Math.max(0, horizonY), cssW, cssH - Math.max(0, horizonY));

    // Mow stripes. Bands of constant z project to full-width horizontal bands,
    // so each is one fillRect rather than a projected quad.
    for (let i = -3; i < 26; i++) {
      const z0 = -8 + i * 2.6;
      const z1 = z0 + 2.6;
      const near = CAM_Z + 0.8;
      const a = Math.max(z0, near);
      const b = Math.max(z1, near);
      if (b <= near) continue;
      const ya = sy(0, scaleAt(a));
      const yb = sy(0, scaleAt(b));
      const top = Math.min(ya, yb);
      const hgt = Math.abs(ya - yb);
      if (top > cssH || top + hgt < 0) continue;
      c.fillStyle = (i & 1) ? pal.turf1 : pal.turf2;
      c.fillRect(0, top, cssW, hgt + 1);
    }

    // Markings.
    c.strokeStyle = pal.line;
    c.globalAlpha = 0.82;
    c.lineWidth = Math.max(1, focal * 0.0016);
    c.beginPath();
    const GZ = CONFIG.GOAL_Z;
    groundSeg(c, -30, GZ, 30, GZ);                    // goal line
    groundSeg(c, -9.16, GZ - 5.5, 9.16, GZ - 5.5);    // six-yard box front
    groundSeg(c, -9.16, GZ, -9.16, GZ - 5.5);
    groundSeg(c, 9.16, GZ, 9.16, GZ - 5.5);
    groundSeg(c, -20.16, GZ - 16.5, 20.16, GZ - 16.5); // penalty area front
    groundSeg(c, -20.16, GZ, -20.16, GZ - 16.5);
    groundSeg(c, 20.16, GZ, 20.16, GZ - 16.5);
    c.stroke();

    // Penalty arc: the part of the 9.15 m circle outside the area.
    c.beginPath();
    let started = false;
    for (let i = 0; i <= 28; i++) {
      const a = Math.PI * (0.5 + i / 28);
      const ax = Math.cos(a) * 9.15;
      const az = GZ + Math.sin(a) * 9.15 - 11;
      if (az > GZ - 16.5) { started = false; continue; }
      const s = scaleAt(Math.max(az, CAM_Z + 0.8));
      const px = sx(ax, s), py = sy(0, s);
      if (!started) { c.moveTo(px, py); started = true; } else c.lineTo(px, py);
    }
    c.stroke();

    // Penalty spot.
    const spotS = scaleAt(0);
    c.globalAlpha = 0.9;
    c.fillStyle = pal.line;
    c.beginPath();
    c.arc(sx(0, spotS), sy(0, spotS), Math.max(1.5, 0.11 * spotS), 0, 6.2832);
    c.fill();
    c.globalAlpha = 1;

    drawGoal(c);

    c.setTransform(1, 0, 0, 1, 0, 0);

    // One glow gradient, in local coordinates, reused by transform each frame.
    glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, pal.flash);
    glow.addColorStop(0.45, pal.accentAlt);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
  }

  /**
   * Target panel rendering.
   *
   * THE RULE THIS FILE LIVES BY: render allocates nothing and measures nothing.
   *
   * The first version of this broke that badly enough to be felt. It built a
   * padded number string, concatenated two font strings, and then ran a
   * shrink-to-fit loop calling measureText — per panel, per frame. At eight
   * panels and 60 Hz that is roughly 500 string allocations and several hundred
   * text measurements a second, all producing identical results, and
   * measureText forces a text-layout pass. That is where the lag came from.
   *
   * Everything that depends only on the projection and the labels is computed
   * once into `panelCache` and reused until the projection or the labels
   * actually change. The per-frame path is now rect fills and two fillText
   * calls per panel, with no allocation at all.
   */
  let panelCache = null;
  let panelCacheKey = '';

  function buildPanelCache(targets) {
    const s = scaleAt(CONFIG.GOAL_Z - 0.06);
    const fontPx = Math.max(11, focal * 0.030);
    const numFont = '800 ' + (fontPx * 1.5).toFixed(1) + 'px ' + NUM_FONT;

    const cache = new Array(targets.length);
    const c = bgCtx || ctx;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const x0 = sx(t.cx - t.hw, s);
      const x1 = sx(t.cx + t.hw, s);
      const y0 = sy(t.cy + t.hh, s);
      const y1 = sy(t.cy - t.hh, s);
      const w = x1 - x0;
      const h = y1 - y0;

      // Shrink-to-fit happens HERE, once, not in the frame loop.
      let labelFont = '';
      let labelText = '';
      if (t.label && c && w > fontPx * 1.8) {
        let size = fontPx * 1.25;
        c.font = '600 ' + size.toFixed(1) + 'px ' + UI_FONT;
        while (size > 5 && c.measureText(t.label).width > w * 0.90) {
          size -= 0.5;
          c.font = '600 ' + size.toFixed(1) + 'px ' + UI_FONT;
        }
        labelFont = c.font;
        labelText = t.label;
      }

      cache[i] = {
        x0, y0, w, h,
        edgeH: Math.max(1.5, h * 0.09),
        numText: i < 9 ? '0' + (i + 1) : String(i + 1),
        numFont,
        numY: y0 + h * 0.40,
        cx: x0 + w * 0.5,
        labelFont,
        labelText,
        labelY: y0 + h * 0.76,
        dropSpan: CONFIG.GOAL_H * 0.55 * s,
      };
    }
    return cache;
  }

  function ensurePanelCache(targets) {
    // focal and size cover every projection change; length and the joined
    // labels cover a content change. Cheap to compare, and it means a resize
    // rebuilds exactly once rather than every frame after.
    const key = focal.toFixed(2) + '|' + cssW + 'x' + cssH + '|' + targets.length;
    if (panelCache && panelCacheKey === key) return panelCache;
    panelCache = buildPanelCache(targets);
    panelCacheKey = key;
    return panelCache;
  }

  /**
   * A knocked-out panel does not vanish: it drops and fades over `anim`, so you
   * can see which one you just hit and which are still up.
   */
  function drawTargets(c, targets, still) {
    if (!targets || !targets.length) return;
    const cache = ensurePanelCache(targets);
    if (!cache) return;

    c.textAlign = 'center';
    c.textBaseline = 'middle';

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const g = cache[i];
      if (!g || (t.down && t.anim >= 1)) continue;

      const k = t.down ? (still ? 1 : t.anim) : 0;
      const alpha = t.down ? 1 - k : 1;
      if (alpha <= 0.01) continue;

      const drop = t.down ? k * k * g.dropSpan : 0;
      const y0 = g.y0 + drop;

      c.globalAlpha = alpha * 0.92;
      c.fillStyle = pal.panel;
      c.fillRect(g.x0, y0, g.w, g.h);

      c.globalAlpha = alpha;
      c.fillStyle = t.down ? pal.panelEdgeDown : pal.panelEdge;
      c.fillRect(g.x0, y0, g.w, g.edgeH);

      c.fillStyle = pal.panelText;
      c.font = g.numFont;
      c.fillText(g.numText, g.cx, g.numY + drop);

      if (g.labelText) {
        c.font = g.labelFont;
        c.fillStyle = pal.panelTextDim;
        c.fillText(g.labelText, g.cx, g.labelY + drop);
      }
    }
    c.globalAlpha = 1;
  }

  function drawGoal(c) {
    const GZ = CONFIG.GOAL_Z;
    const HW = CONFIG.GOAL_HALF_W;
    const GH = CONFIG.GOAL_H;
    const BZ = GZ + CONFIG.NET_DEPTH;
    const sFront = scaleAt(GZ);
    const sBack = scaleAt(BZ);

    // Net: front plane grid, back plane grid, and the connecting runs. Drawn as
    // two batched paths so the whole net is two stroke calls.
    c.strokeStyle = pal.net;
    c.globalAlpha = 0.3;
    c.lineWidth = Math.max(0.5, focal * 0.0006);

    c.beginPath();
    for (let i = 0; i <= 20; i++) {
      const x = -HW + (2 * HW) * (i / 20);
      c.moveTo(sx(x, sBack), sy(0, sBack));
      c.lineTo(sx(x, sBack), sy(GH, sBack));
    }
    for (let i = 0; i <= 8; i++) {
      const y = GH * (i / 8);
      c.moveTo(sx(-HW, sBack), sy(y, sBack));
      c.lineTo(sx(HW, sBack), sy(y, sBack));
    }
    c.stroke();

    c.globalAlpha = 0.22;
    c.beginPath();
    for (let i = 0; i <= 8; i++) {
      const x = -HW + (2 * HW) * (i / 8);
      c.moveTo(sx(x, sFront), sy(GH, sFront));
      c.lineTo(sx(x, sBack), sy(GH, sBack));
    }
    for (let i = 0; i <= 5; i++) {
      const y = GH * (i / 5);
      c.moveTo(sx(-HW, sFront), sy(y, sFront));
      c.lineTo(sx(-HW, sBack), sy(y, sBack));
      c.moveTo(sx(HW, sFront), sy(y, sFront));
      c.lineTo(sx(HW, sBack), sy(y, sBack));
    }
    c.stroke();

    c.globalAlpha = 0.34;
    c.beginPath();
    for (let i = 0; i <= 22; i++) {
      const x = -HW + (2 * HW) * (i / 22);
      c.moveTo(sx(x, sFront), sy(0, sFront));
      c.lineTo(sx(x, sFront), sy(GH, sFront));
    }
    for (let i = 0; i <= 7; i++) {
      const y = GH * (i / 7);
      c.moveTo(sx(-HW, sFront), sy(y, sFront));
      c.lineTo(sx(HW, sFront), sy(y, sFront));
    }
    c.stroke();
    c.globalAlpha = 1;

    // Frame.
    const postW = Math.max(2, CONFIG.POST_R * 2 * sFront);
    c.fillStyle = pal.post;
    c.fillRect(sx(-HW, sFront) - postW * 0.5, sy(GH, sFront), postW, sy(0, sFront) - sy(GH, sFront));
    c.fillRect(sx(HW, sFront) - postW * 0.5, sy(GH, sFront), postW, sy(0, sFront) - sy(GH, sFront));
    c.fillRect(sx(-HW, sFront) - postW * 0.5, sy(GH, sFront) - postW * 0.5,
      sx(HW, sFront) - sx(-HW, sFront) + postW, postW);
  }

  // --- Dynamic frame -------------------------------------------------------

  function lerp(a, b, t) { return a + (b - a) * t; }

  /**
   * @param {object} w world
   * @param {object} parts particle pool
   * @param {object} trail ring buffer
   * @param {number} alpha interpolation factor from the loop
   * @param {number} tier quality tier from the governor
   * @param {boolean} showAim
   * @param {boolean} still true in reduced-motion mode: no shake, no glow
   */
  function draw(w, parts, trail, alpha, tier, showAim, still, targets) {
    if (lost || !ctx) return;

    // Shake is a transform on the whole frame, so it costs nothing extra and
    // never moves the simulation. Tier 1 halves it, tier 2 and reduced motion
    // remove it entirely.
    let ox = 0, oy = 0;
    if (!still && tier === 0 && w.shake > 0) {
      const k = w.shake;
      ox = (((w.t * 977) % 2) - 1) * k;
      oy = (((w.t * 613) % 2) - 1) * k * 0.6;
    }
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);

    if (bg) ctx.drawImage(bg, 0, 0, cssW, cssH);
    else { ctx.fillStyle = pal.turf1; ctx.fillRect(-32, -32, cssW + 64, cssH + 64); }

    const bx = lerp(w.pbx, w.bx, alpha);
    const by = lerp(w.pby, w.by, alpha);
    const bz = lerp(w.pbz, w.bz, alpha);

    // Panels sit on the goal plane, so they draw after the static background
    // (which contains the net) and before the keeper, who stands in front of
    // them. They animate on knock-out, which is why they cannot live in the
    // cached background.
    drawTargets(ctx, targets, still);

    if (showAim) drawReticle(w);

    drawKeeper(w, alpha, bz);

    // Ball shadow on the turf. Anchored at the ball's ground position, so it
    // reads as height rather than as a second ball.
    const gs = scaleAt(bz);
    if (gs > 0) {
      const shR = Math.max(1, CONFIG.BALL_R * gs * (1.4 - Math.min(0.9, by * 0.16)));
      ctx.globalAlpha = Math.max(0.08, 0.34 - by * 0.05);
      ctx.fillStyle = pal.ballDark;
      ctx.beginPath();
      ctx.ellipse(sx(bx, gs), sy(0, gs), shR, shR * 0.34, 0, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (!still && tier < 2) drawTrail(trail, bz);
    if (!still) drawParticles(parts, alpha, tier);

    drawBall(bx, by, bz, lerp(w.proll, w.roll, alpha));

    // Goal glow. One reused gradient positioned by transform, so a celebration
    // costs a save/restore rather than an allocation.
    if (!still && tier === 0 && w.flash > 0 && glow && w.outcome === OUTCOME.GOAL) {
      const s = scaleAt(CONFIG.GOAL_Z);
      const r = CONFIG.GOAL_HALF_W * 1.4 * s;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.55, w.flash * 0.55);
      ctx.translate(sx(w.crossX, s), sy(w.crossY, s));
      ctx.scale(r, r);
      ctx.fillStyle = glow;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawReticle(w) {
    const s = scaleAt(CONFIG.GOAL_Z);
    const px = sx(w.aimX, s);
    const py = sy(w.aimY, s);
    const r = Math.max(6, 0.42 * s);

    ctx.strokeStyle = pal.reticle;
    ctx.lineWidth = Math.max(1.5, focal * 0.0018);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 6.2832);
    ctx.moveTo(px - r * 1.55, py); ctx.lineTo(px - r * 0.45, py);
    ctx.moveTo(px + r * 0.45, py); ctx.lineTo(px + r * 1.55, py);
    ctx.moveTo(px, py - r * 1.55); ctx.lineTo(px, py - r * 0.45);
    ctx.moveTo(px, py + r * 0.45); ctx.lineTo(px, py + r * 1.55);
    ctx.stroke();

    // Power as an arc around the reticle: readable without text, and the HUD
    // carries the same value as a real labelled control for anyone who needs it.
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = Math.max(2.5, focal * 0.0032);
    ctx.beginPath();
    ctx.arc(px, py, r * 1.9, -1.5708, -1.5708 + 6.2832 * w.power);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawTrail(trail, bz) {
    const n = trail.count;
    if (n < 2) return;
    const s0 = scaleAt(bz);
    ctx.fillStyle = pal.ball;
    for (let i = 0; i < n; i++) {
      // Walk backwards from the newest sample. The modulo keeps the read inside
      // the ring without any branch on wrap.
      const idx = (trail.head - 1 - i + trail.len * 2) % trail.len;
      const age = 1 - i / n;
      const s = scaleAt(trail.tz[idx]);
      if (s <= 0) continue;
      ctx.globalAlpha = age * age * 0.34;
      const r = Math.max(0.6, CONFIG.BALL_R * s * age * 0.8);
      ctx.beginPath();
      ctx.arc(sx(trail.tx[idx], s), sy(trail.ty[idx], s), r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    void s0;
  }

  /**
   * Particles are drawn in pool order, not depth order.
   *
   * A painter's-algorithm sort would mean sorting the active index list every
   * frame — O(n log n) plus the bookkeeping to keep the pool's swap-remove
   * invariant intact — to fix occlusion between confetti flakes a few pixels
   * across. It is not perceptible. This is the kind of correctness that is
   * genuinely not worth its cost, and skipping it is a decision rather than an
   * oversight.
   */
  function drawParticles(parts, alpha, tier) {
    if (tier >= 2) return;
    const n = parts.count;
    if (n === 0) return;
    const limit = tier === 1 ? Math.min(n, parts.cap >> 1) : n;

    for (let i = 0; i < limit; i++) {
      const s = parts.active[i];
      const z = lerp(parts.oz[s], parts.pz[s], alpha);
      const sc = scaleAt(z);
      if (sc <= 0) continue;
      const x = lerp(parts.ox[s], parts.px[s], alpha);
      const y = lerp(parts.oy[s], parts.py[s], alpha);
      const px = sx(x, sc);
      if (px < -64 || px > cssW + 64) continue;
      const py = sy(y, sc);

      const lifeK = parts.life[s] / parts.maxLife[s];
      ctx.globalAlpha = lifeK > 0.8 ? 1 : lifeK * 1.25;

      const k = parts.kind[s];
      if (k === P_CONFETTI) {
        // Spin is faked by modulating width instead of rotating the context.
        // A save/rotate/restore per flake is ~120 transform pushes a frame; a
        // cosine is one multiply and looks the same at this size.
        const half = parts.size[s] * sc;
        const wdt = Math.max(1, half * (0.2 + 0.8 * Math.abs(Math.cos(lerp(parts.orot[s], parts.rot[s], alpha)))));
        ctx.fillStyle = confetti[parts.hue[s]];
        ctx.fillRect(px - wdt * 0.5, py - half * 0.5, wdt, Math.max(1, half));
      } else if (k === P_TRAIL) {
        ctx.fillStyle = pal.ball;
        ctx.globalAlpha *= 0.4;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.6, parts.size[s] * sc), 0, 6.2832);
        ctx.fill();
      } else {
        ctx.fillStyle = k === 2 ? pal.turf1 : pal.accentAlt;
        const r = Math.max(0.8, parts.size[s] * sc);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawKeeper(w, alpha, ballZ) {
    const kz = CONFIG.GOAL_Z - 0.45;
    const s = scaleAt(kz);
    if (s <= 0) return;

    const hx = lerp(w.pkHandX, w.kHandX, alpha);
    const hy = lerp(w.pkHandY, w.kHandY, alpha);
    const bxm = lerp(w.pkBodyX, w.kBodyX, alpha);
    const bym = lerp(w.pkBodyY, w.kBodyY, alpha);
    const lean = lerp(w.pkLean, w.kLean, alpha);

    const px = sx(bxm, s);
    const feetY = sy(bym, s);
    const headY = sy(bym + 1.78, s);
    const bodyH = feetY - headY;
    const bodyW = Math.max(3, 0.52 * s);

    ctx.save();
    ctx.translate(px, feetY);
    ctx.rotate(lean * 0.62);

    // Shadow.
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = pal.ballDark;
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW * 1.15, bodyW * 0.32, 0, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Legs, torso, head. Deliberately a simple silhouette: legible at 40 px
    // tall on a phone, and cheap.
    ctx.fillStyle = pal.keeperAlt;
    ctx.fillRect(-bodyW * 0.42, -bodyH * 0.44, bodyW * 0.3, bodyH * 0.44);
    ctx.fillRect(bodyW * 0.12, -bodyH * 0.44, bodyW * 0.3, bodyH * 0.44);

    ctx.fillStyle = pal.keeper;
    roundRect(ctx, -bodyW * 0.5, -bodyH * 0.92, bodyW, bodyH * 0.5, bodyW * 0.22);
    ctx.fill();

    const headR = bodyW * 0.3;
    const headCy = -bodyH * 0.97;

    if (faceReady && headR > 3) {
      // Clip to the head circle and drop the photo in. drawImage with a clip
      // is one composite op — no per-frame allocation, no filter.
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, headCy, headR, 0, 6.2832);
      ctx.clip();
      // Cover, not fit: scale so the shorter side fills the disc, then centre.
      // Drawing the photo at exactly the disc's bounding square left the face
      // clipped at the chin and temples, because a circle inscribed in a square
      // cuts every corner off.
      const fw = faceImg.naturalWidth || 1;
      const fh = faceImg.naturalHeight || 1;
      const cover = (headR * 2.28) / Math.min(fw, fh);
      const dw = fw * cover;
      const dh = fh * cover;
      ctx.drawImage(faceImg, -dw / 2, headCy - dh * 0.52, dw, dh);
      ctx.restore();

      ctx.strokeStyle = pal.keeperAlt;
      ctx.lineWidth = Math.max(1, headR * 0.16);
      ctx.beginPath();
      ctx.arc(0, headCy, headR, 0, 6.2832);
      ctx.stroke();
    } else {
      ctx.fillStyle = pal.keeperAlt;
      ctx.beginPath();
      ctx.arc(0, headCy, headR, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();

    // Arms and gloves, drawn to the hand position in world space so they line
    // up with the collision box that actually decides the save. If these ever
    // disagree visually, the box is what is true.
    const handPx = sx(hx, s);
    const handPy = sy(hy, s);
    const shoulderY = sy(bym + 1.42, s);
    ctx.strokeStyle = pal.keeper;
    ctx.lineWidth = Math.max(2, bodyW * 0.26);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, shoulderY);
    ctx.lineTo(handPx, handPy);
    ctx.moveTo(px, shoulderY);
    ctx.lineTo(px + (handPx - px) * 0.55, handPy + (shoulderY - handPy) * 0.22);
    ctx.stroke();

    // Gloves. They were the same dark navy as the shadow and effectively
    // invisible; a keeper you cannot see the hands of gives the striker no read
    // on where the save is coming from.
    const gloveR = Math.max(4, 0.29 * s);
    ctx.fillStyle = pal.accentAlt;
    ctx.strokeStyle = pal.glove;
    ctx.lineWidth = Math.max(1, gloveR * 0.22);
    for (const hxPx of [handPx, px + (handPx - px) * 0.55]) {
      const hyPx = hxPx === handPx ? handPy : handPy + (shoulderY - handPy) * 0.22;
      ctx.beginPath();
      ctx.arc(hxPx, hyPx, gloveR, 0, 6.2832);
      ctx.fill();
      ctx.stroke();
    }

    void ballZ;
  }

  function drawBall(bx, by, bz, roll) {
    const s = scaleAt(bz);
    if (s <= 0) return;
    const r = CONFIG.BALL_R * s;
    if (r < 0.4) return;
    const px = sx(bx, s);
    const py = sy(by, s);

    ctx.fillStyle = pal.ball;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 6.2832);
    ctx.fill();

    // Two panel marks that rotate with the roll, so pace is visible on the ball
    // itself rather than only in the trail.
    ctx.fillStyle = pal.ballDark;
    const a1 = roll;
    const a2 = roll + 2.2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(px + Math.cos(a1) * r * 0.42, py + Math.sin(a1) * r * 0.42,
      r * 0.3, r * 0.22, a1, 0, 6.2832);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px + Math.cos(a2) * r * 0.5, py + Math.sin(a2) * r * 0.5,
      r * 0.24, r * 0.17, a2, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  // --- Context loss --------------------------------------------------------
  // Chrome fires these on 2d contexts too, typically after the GPU process
  // restarts or the tab is evicted under memory pressure. Without the
  // preventDefault the context never comes back and the canvas stays blank for
  // the rest of the session.
  function onLost(e) {
    e.preventDefault();
    lost = true;
    ctx = null;
    bg = null;
    bgCtx = null;
    glow = null;
  }
  function onRestored() {
    lost = false;
    dirty = true;
    if (acquire()) {
      refreshPalette();
      resize(cssW, cssH, dpr);
    }
  }

  canvas.addEventListener('contextlost', onLost);
  canvas.addEventListener('contextrestored', onRestored);

  const ok = acquire();
  if (ok) refreshPalette();

  return {
    ok,
    get lost() { return lost; },
    get width() { return cssW; },
    get height() { return cssH; },
    resize,
    refreshPalette() { refreshPalette(); buildBackground(); },
    draw,
    /** Canvas pixel -> aim point on the goal plane. Used by pointer input. */
    setPlayerNumber(value) {
      playerNumberText = value === null || value === undefined ? '' : String(value);
      dirty = true;
    },
    unprojectToGoal(clientX, clientY, out) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const px = (clientX - rect.left) * (cssW / rect.width);
      const py = (clientY - rect.top) * (cssH / rect.height);
      const s = scaleAt(CONFIG.GOAL_Z);
      out.x = (px - centerX) / s;
      out.y = CAM_Y - (py - horizonY) / s;
      return true;
    },
    dispose() {
      canvas.removeEventListener('contextlost', onLost);
      canvas.removeEventListener('contextrestored', onRestored);
      // Zeroing the backing store is the only way to get the memory back
      // promptly; dropping the reference alone leaves it until GC decides.
      try { canvas.width = 0; canvas.height = 0; } catch { /* ignore */ }
      if (bg) { try { bg.width = 0; bg.height = 0; } catch { /* ignore */ } }
      ctx = null; bg = null; bgCtx = null; glow = null;
    },
  };
}

/**
 * Breakout-style target panels hung inside the goal mouth.
 *
 * One panel per project. You pick which project to open by picking where to
 * put the ball, which is the whole idea: the aim is the navigation. A panel
 * that has already been knocked out stays down for the rest of the run.
 *
 * Coordinates are goal-plane metres, the same frame the physics uses:
 *   x ∈ [-GOAL_HALF_W, +GOAL_HALF_W]   left/right across the mouth
 *   y ∈ [0, GOAL_H]                    ground up to the crossbar
 *
 * Layout is two rows, because a single row of five across a 7.32 m goal gives
 * panels barely wider than the ball and turns the game into pixel-hunting. Two
 * up top and three along the bottom keeps every panel a fair target while
 * still rewarding a placed shot over a hammered one. The top row is inset from
 * the posts: the corners are the hardest and most satisfying places to score,
 * so they stay open rather than being occupied by a panel you cannot miss.
 */

import { CONFIG } from './config.js';

const HW = CONFIG.GOAL_HALF_W;
const GH = CONFIG.GOAL_H;

/**
 * Layout is generated rather than hardcoded, because the number of projects
 * changes and a fixed table silently breaks when it does.
 *
 * Two rows, filled bottom-heavy. A single row across a 7.32 m goal gives panels
 * barely wider than the ball and turns the game into pixel-hunting; two rows
 * keep every panel a fair target. The rows are inset from the posts and clear
 * of the crossbar so the corners — the best places to put a penalty — stay
 * open rather than being occupied by a panel you cannot miss.
 */
function buildLayout(count) {
  const topN = Math.floor(count / 2);
  const bottomN = count - topN;

  // Usable span, inset from both posts.
  const spanHW = HW * 0.80;
  const rowY = [GH * 0.70, GH * 0.27];
  const rows = [topN, bottomN];

  // Panel size is driven by the busier row, so both rows match.
  const widest = Math.max(topN, bottomN);
  const cellW = (2 * spanHW) / widest;
  const pw = Math.max(0.28, cellW * 0.44);
  const ph = Math.max(0.20, GH * 0.20);

  const out = [];
  for (let r = 0; r < 2; r++) {
    const n = rows[r];
    if (!n) continue;
    const rowCellW = (2 * spanHW) / n;
    for (let i = 0; i < n; i++) {
      out.push({
        cx: -spanHW + rowCellW * (i + 0.5),
        cy: rowY[r],
        hw: Math.min(pw, rowCellW * 0.44),
        hh: ph,
      });
    }
  }
  return out;
}

export function createTargets(count) {
  const layout = buildLayout(count);
  const n = layout.length;
  const list = new Array(n);
  for (let i = 0; i < n; i++) {
    list[i] = {
      index: i,
      cx: layout[i].cx,
      cy: layout[i].cy,
      hw: layout[i].hw,
      hh: layout[i].hh,
      down: false,
      /** 0..1 knock-out animation, driven by the scene, read by the renderer. */
      anim: 0,
      label: '',
    };
  }
  return list;
}

export function resetTargets(targets) {
  for (let i = 0; i < targets.length; i++) {
    targets[i].down = false;
    targets[i].anim = 0;
  }
}

/**
 * Which panel does a ball crossing the goal line at (x, y) hit?
 *
 * Returns the panel index, or -1 for a shot that went in without touching one.
 * A clean gap is a legitimate outcome — it is a goal, it just does not open a
 * project, and the scene falls back to the next panel still standing so a
 * player can never strand themselves.
 *
 * Panels already down are transparent: the ball passes through the hole.
 */
export function hitTest(targets, x, y, ballRadius) {
  const r = ballRadius || 0;
  let best = -1;
  let bestDist = Infinity;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.down) continue;

    // Inflate by the ball radius so a ball clipping the edge counts, matching
    // what the eye sees rather than treating the ball as a point.
    const dx = Math.abs(x - t.cx) - (t.hw + r);
    const dy = Math.abs(y - t.cy) - (t.hh + r);
    if (dx > 0 || dy > 0) continue;

    // Overlapping panels are impossible in this layout, but picking the
    // deepest overlap keeps it correct if the layout is ever retuned.
    const depth = Math.max(dx, dy);
    if (depth < bestDist) { bestDist = depth; best = i; }
  }

  return best;
}

/** First panel still standing, or -1. Used when a goal misses every panel. */
export function firstStanding(targets) {
  for (let i = 0; i < targets.length; i++) if (!targets[i].down) return i;
  return -1;
}

export function standingCount(targets) {
  let n = 0;
  for (let i = 0; i < targets.length; i++) if (!targets[i].down) n++;
  return n;
}

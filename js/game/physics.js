/**
 * Ball and keeper simulation. Deterministic, allocation-free, frame-rate
 * independent — every number it needs lives on one flat object created once at
 * mount.
 *
 * WHY THE WORLD IS ONE FLAT OBJECT OF NUMBERS, NOT NESTED VECTORS
 * `{ ball: { pos: {x,y,z} } }` reads better and is worse here: three object
 * derefs per access, three separate allocations at init, and every `new Vec3()`
 * in a step function is garbage. A `Vec3` class with reused scratch instances
 * is the usual fix and it still costs a pointer hop per field. With exactly two
 * moving bodies, flat scalar fields on a single object keep the whole world in
 * one hidden class that the JIT can keep in registers. At two thousand bodies
 * this would be a typed-array SoA (which is what the particle pool is); at two,
 * it is this.
 *
 * WHY THERE IS NO SPATIAL PARTITION
 * There is one ball, one keeper and four static planes. That is at most five
 * pair tests per step. A quadtree, grid hash or BVH would add per-frame
 * insertion, allocation and pointer chasing to replace five multiply-compares,
 * and would be slower by every measure. Broad-phase structures earn their place
 * when the pair count is quadratic in a large n; here n is 2. Building one
 * anyway would be cargo-culting the shape of a physics engine without the
 * problem that justifies it.
 *
 * WHAT IS ACTUALLY NEEDED IS A SWEPT TEST, NOT A FASTER BROAD PHASE
 * A penalty crosses ~11 m in ~0.7 s, so the ball moves ~26 cm per 60 Hz step —
 * larger than its own radius and comparable to the keeper's hands. A discrete
 * overlap test at the step boundary tunnels straight through both the keeper
 * and the goal line, and the usual reflex of raising the tick rate only makes
 * tunnelling rarer while costing CPU on every device. Instead each step tests
 * the *segment* from the previous position to the new one: exact at any step
 * rate, constant cost, and it also yields the precise crossing point, which is
 * what decides post vs. wide and where the confetti spawns.
 */

import { CONFIG, OUTCOME, FLAVOR } from './config.js';

// Event bits. A bitmask rather than an array of event objects, because the
// scene polls this once per step and an array would be an allocation per step.
export const EV_CROSS = 1;
export const EV_BOUNCE = 2;
export const EV_NET = 4;
export const EV_WOOD = 8;
export const EV_SAVE = 16;
export const EV_SETTLED = 32;

/** One mutable world. Created once per mount, reset per round. */
export function createWorld() {
  return {
    // Ball: current and previous-step position, for interpolation and sweeps.
    bx: 0, by: CONFIG.SPOT_Y, bz: 0,
    pbx: 0, pby: CONFIG.SPOT_Y, pbz: 0,
    vx: 0, vy: 0, vz: 0,
    curveA: 0,
    roll: 0, proll: 0,

    // Keeper: hand box centre plus body anchor for the renderer.
    kHandX: 0, kHandY: 1.15,
    pkHandX: 0, pkHandY: 1.15,
    kBodyX: 0, kBodyY: 0,
    pkBodyX: 0, pkBodyY: 0,
    kHalfX: CONFIG.KEEPER_HAND_HX, kHalfY: CONFIG.KEEPER_HAND_HY,
    kZoneX: 0, kZoneY: 0,
    kLean: 0, pkLean: 0,

    // Flight bookkeeping.
    t: 0,
    flightT: 0,
    live: false,
    settled: true,
    outcome: OUTCOME.PENDING,
    flavor: FLAVOR.NONE,
    crossX: 0, crossY: 0, crossed: false,
    contactX: 0, contactY: 0, contactZ: 0,
    settleTimer: 0,
    netHit: false,
    events: 0,

    // Presentation only, read by the renderer.
    shake: 0,
    flash: 0,
    aimX: 0, aimY: 1.0, power: 0.55, curve: 0,
  };
}

/** Put the world back to a ready-to-shoot state. Mutates, never reallocates. */
export function resetRound(w) {
  w.bx = 0; w.by = CONFIG.SPOT_Y; w.bz = 0;
  w.pbx = 0; w.pby = CONFIG.SPOT_Y; w.pbz = 0;
  w.vx = 0; w.vy = 0; w.vz = 0;
  w.curveA = 0;
  w.roll = 0; w.proll = 0;
  w.kHandX = 0; w.kHandY = 1.15;
  w.pkHandX = 0; w.pkHandY = 1.15;
  w.kBodyX = 0; w.kBodyY = 0;
  w.pkBodyX = 0; w.pkBodyY = 0;
  w.kZoneX = 0; w.kZoneY = 0;
  w.kLean = 0; w.pkLean = 0;
  w.t = 0;
  w.live = false;
  w.settled = true;
  w.outcome = OUTCOME.PENDING;
  w.flavor = FLAVOR.NONE;
  w.crossed = false;
  w.crossX = 0; w.crossY = 0;
  w.settleTimer = 0;
  w.netHit = false;
  w.events = 0;
  w.shake = 0;
  w.flash = 0;
}

/**
 * Solve the launch velocity analytically so the ball arrives exactly where it
 * was aimed, at exactly the chosen flight time, curve included:
 *
 *   z(t) = vz·t                    → vz = GOAL_Z / T
 *   x(t) = vx·t + ½·c·t²           → vx = (gx − ½·c·T²) / T
 *   y(t) = y₀ + vy·t − ½·g·t²      → vy = (gy − y₀ + ½·g·T²) / T
 *
 * Closed form, no iteration, no search. The alternative — pick a velocity and
 * let the player learn where it lands — makes aiming feel broken, and adding
 * air drag would mean the aim point and the landing point disagree. Drag is
 * left out deliberately: at 11 m it is a few centimetres, and "the reticle is
 * where the ball goes" is worth more than that.
 *
 * Spread is applied to the target *before* the solve, so a mishit is a real
 * trajectory rather than a visual lie.
 */
export function launch(w, aimX, aimY, power, curve, rng) {
  const C = CONFIG;
  const p = clamp01(power);

  const spread = C.SPREAD_MIN + (C.SPREAD_MAX - C.SPREAD_MIN) * p;
  const gx = aimX + rng.gauss() * spread;
  const gy = aimY + rng.gauss() * spread * 0.72;

  const T = C.FLIGHT_T_SLOW + (C.FLIGHT_T_FAST - C.FLIGHT_T_SLOW) * p;
  const c = curve * C.CURVE_MAX;

  w.aimX = aimX; w.aimY = aimY; w.power = p; w.curve = curve;
  w.flightT = T;
  w.curveA = c;
  w.vz = C.GOAL_Z / T;
  w.vx = (gx - 0.5 * c * T * T) / T;
  w.vy = (gy - C.SPOT_Y + 0.5 * C.GRAVITY * T * T) / T;
  w.t = 0;
  w.live = true;
  w.settled = false;
  w.outcome = OUTCOME.PENDING;
  w.flavor = FLAVOR.NONE;
  w.crossed = false;
  w.netHit = false;
  w.settleTimer = 0;
  w.events = 0;

  decideKeeper(w, aimX, aimY, p, rng);
}

/**
 * The keeper commits at the moment of the strike, from the striker's body
 * shape — the *intended* aim, not the mishit. A keeper who reads the mishit
 * would be reading the future.
 *
 * Reading the shot is not the same as saving it: the dive still has to arrive,
 * and the hand box is finite, so a well-struck corner beats a correct guess.
 * That is the whole point of a penalty and it keeps the game honest.
 */
function decideKeeper(w, aimX, aimY, power, rng) {
  const trueX = aimX < -1.2 ? -1 : (aimX > 1.2 ? 1 : 0);
  const trueY = aimY > 1.25 ? 1 : 0;

  const readP = CONFIG.KEEPER_READ_P + 0.16 * (1 - power);
  if (rng.chance(readP)) {
    w.kZoneX = trueX;
    w.kZoneY = trueY;
  } else {
    w.kZoneX = rng.int(3) - 1;
    w.kZoneY = rng.int(2);
  }
}

/** Ease-out quad. Keepers leave fast and decelerate at full stretch. */
function easeOut(u) { const v = 1 - u; return 1 - v * v; }

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

/**
 * One fixed step. Nothing in this function allocates: no object literals, no
 * array methods, no template strings, no closures.
 */
export function step(w, dt, rng) {
  const C = CONFIG;
  w.events = 0;

  // Presentation decays run even when the ball is dead, so the shake from a
  // goal settles while the reveal panel is up.
  if (w.shake > 0) { w.shake -= dt * 26; if (w.shake < 0) w.shake = 0; }
  if (w.flash > 0) { w.flash -= dt * 2.6; if (w.flash < 0) w.flash = 0; }

  // Keeper ready-sway before the shot, so the scene is alive while aiming.
  w.pkHandX = w.kHandX; w.pkHandY = w.kHandY;
  w.pkBodyX = w.kBodyX; w.pkBodyY = w.kBodyY;
  w.pkLean = w.kLean;

  if (!w.live) {
    w.t += dt;
    const sway = Math.sin(w.t * 1.9) * 0.16;
    w.kBodyX = sway;
    w.kHandX = sway * 1.35;
    w.kHandY = 1.15;
    w.kBodyY = 0;
    w.kLean = sway * 0.5;
    w.kHalfX = C.KEEPER_HAND_HX;
    w.kHalfY = C.KEEPER_HAND_HY;
    return;
  }

  w.t += dt;

  // --- Keeper dive ---------------------------------------------------------
  const u = clamp01((w.t - C.KEEPER_REACT) / C.KEEPER_DIVE_T);
  const e = easeOut(u);
  const targetY = w.kZoneY ? 1.95 : 0.5;

  if (w.kZoneX === 0) {
    // Standing keeper: no lateral reach, but the body itself is a taller,
    // narrower obstacle than a pair of outstretched hands.
    w.kHandX = 0;
    w.kHandY = 1.15 + (w.kZoneY ? 0.62 : -0.45) * e;
    w.kBodyX = 0;
    w.kBodyY = w.kZoneY ? e * 0.35 : 0;
    w.kLean = 0;
    w.kHalfX = 0.66;
    w.kHalfY = w.kZoneY ? 0.72 : 0.78;
  } else {
    w.kHandX = w.kZoneX * C.KEEPER_REACH_X * e;
    w.kHandY = 1.15 + (targetY - 1.15) * e;
    w.kBodyX = w.kZoneX * C.KEEPER_REACH_X * 0.52 * e;
    w.kBodyY = e * (w.kZoneY ? 0.55 : 0.18);
    w.kLean = w.kZoneX * e;
    w.kHalfX = C.KEEPER_HAND_HX;
    w.kHalfY = C.KEEPER_HAND_HY;
  }

  // --- Ball integration ----------------------------------------------------
  w.pbx = w.bx; w.pby = w.by; w.pbz = w.bz;
  w.proll = w.roll;

  w.vy -= C.GRAVITY * dt;
  w.vx += w.curveA * dt;

  w.bx += w.vx * dt;
  w.by += w.vy * dt;
  w.bz += w.vz * dt;

  const speed = Math.sqrt(w.vx * w.vx + w.vy * w.vy + w.vz * w.vz);
  w.roll += speed * dt * 1.6;

  // Ground bounce. A ball that bounces in front of the line and still crosses
  // it is a goal, which the plane test below handles for free.
  if (w.by < C.BALL_R) {
    w.by = C.BALL_R;
    if (w.vy < 0) {
      if (w.vy < -1.2) w.events |= EV_BOUNCE;
      w.vy = -w.vy * C.GROUND_RESTITUTION;
      w.vx *= C.GROUND_FRICTION;
      w.vz *= C.GROUND_FRICTION;
    }
  }

  // --- Keeper intercept (swept) -------------------------------------------
  // Tested before the goal-plane crossing because the hand box sits wholly in
  // front of the line, so a save always happens first in space as well as in
  // code. The box is treated as static within a step: it moves at most ~8 cm
  // per step at full stretch against half-extents of ~50 cm, so the error is
  // an order of magnitude below the thing being measured.
  if (w.outcome === OUTCOME.PENDING && w.bz > C.GOAL_Z - C.KEEPER_PLANE_OFF - 1.5) {
    const kz = C.GOAL_Z - C.KEEPER_PLANE_OFF * 0.5;
    const hit = sweptBox(
      w.pbx, w.pby, w.pbz, w.bx, w.by, w.bz,
      w.kHandX, w.kHandY, kz,
      w.kHalfX + C.BALL_R, w.kHalfY + C.BALL_R, C.KEEPER_PLANE_OFF * 0.5 + C.BALL_R,
    );
    if (hit >= 0) {
      w.outcome = OUTCOME.SAVE;
      w.flavor = FLAVOR.HANDS;
      w.contactX = w.pbx + (w.bx - w.pbx) * hit;
      w.contactY = w.pby + (w.by - w.pby) * hit;
      w.contactZ = w.pbz + (w.bz - w.pbz) * hit;
      w.events |= EV_SAVE;
      w.settleTimer = C.SETTLE_S;
      w.shake = 6;

      // Push the ball back out. Sign the lateral component away from the hands
      // so a save never deflects the ball back into the middle of the goal.
      const away = w.contactX >= w.kHandX ? 1 : -1;
      w.bx = w.contactX; w.by = w.contactY; w.bz = w.contactZ - C.BALL_R * 0.5;
      const vzAbs = Math.abs(w.vz);
      w.vz = -vzAbs * 0.4;
      w.vx = away * (1.8 + vzAbs * 0.14);
      w.vy = Math.abs(w.vy) * 0.3 + 2.1;
    }
  }

  // --- Goal plane crossing (swept) -----------------------------------------
  if (!w.crossed && w.pbz < C.GOAL_Z && w.bz >= C.GOAL_Z) {
    const denom = w.bz - w.pbz;
    const s = denom > 1e-6 ? (C.GOAL_Z - w.pbz) / denom : 0;
    const cx = w.pbx + (w.bx - w.pbx) * s;
    const cy = w.pby + (w.by - w.pby) * s;
    w.crossed = true;
    w.crossX = cx;
    w.crossY = cy;
    w.events |= EV_CROSS;

    if (w.outcome === OUTCOME.PENDING) {
      const ax = cx < 0 ? -cx : cx;
      const band = C.BALL_R + C.POST_R;

      if (ax > C.GOAL_HALF_W + band) {
        w.outcome = OUTCOME.MISS; w.flavor = FLAVOR.WIDE;
      } else if (cy > C.GOAL_H + band) {
        w.outcome = OUTCOME.MISS; w.flavor = FLAVOR.OVER;
      } else if (ax > C.GOAL_HALF_W - band) {
        w.outcome = OUTCOME.MISS; w.flavor = FLAVOR.POST;
        w.vx = -w.vx * 0.55 + (cx > 0 ? 3.0 : -3.0);
        w.vz *= -0.35;
        w.events |= EV_WOOD;
        w.shake = 9;
      } else if (cy > C.GOAL_H - band) {
        w.outcome = OUTCOME.MISS; w.flavor = FLAVOR.BAR;
        w.vy = -Math.abs(w.vy) * 0.5 - 1.5;
        w.vz *= 0.5;
        w.events |= EV_WOOD;
        w.shake = 9;
      } else {
        w.outcome = OUTCOME.GOAL; w.flavor = FLAVOR.NONE;
        w.shake = C.SHAKE_MAX;
        w.flash = 1;
      }
      w.settleTimer = C.SETTLE_S;
    }
  }

  // Net catch. Only a goal meets the net; a shot past the post keeps going.
  if (w.outcome === OUTCOME.GOAL && w.bz > C.GOAL_Z + C.NET_DEPTH * 0.55) {
    if (!w.netHit) { w.netHit = true; w.events |= EV_NET; }
    w.vz *= 0.12;
    w.vx *= 0.66;
    w.vy = w.vy * 0.5 - 1.2;
  }

  // --- Settle --------------------------------------------------------------
  if (w.outcome !== OUTCOME.PENDING) {
    w.settleTimer -= dt;
    if (w.settleTimer <= 0 && !w.settled) {
      w.settled = true;
      w.live = false;
      w.events |= EV_SETTLED;
    }
  } else if (w.t > w.flightT + 3.5) {
    // Safety net. If some numeric path meant the plane was never crossed, the
    // round still ends and the content still gets revealed. Content is never
    // allowed to depend on the simulation behaving.
    w.outcome = OUTCOME.MISS;
    w.flavor = FLAVOR.WIDE;
    w.crossed = true;
    w.crossX = w.bx; w.crossY = w.by;
    w.settled = true;
    w.live = false;
    w.events |= EV_CROSS | EV_SETTLED;
  }

  void rng;
}

/**
 * Segment vs. axis-aligned box, slab method. Returns the parametric hit time in
 * [0, 1] along the segment, or -1 for a miss.
 *
 * The box is pre-expanded by the ball radius by the caller (a Minkowski sum),
 * which turns sphere-vs-box into point-vs-box. That approximates the ball as a
 * cube at the corners — a few centimetres of generosity on a keeper's glove,
 * which is the right direction to be wrong in and costs three branches instead
 * of a quadratic solve.
 */
export function sweptBox(x0, y0, z0, x1, y1, z1, cx, cy, cz, hx, hy, hz) {
  let tmin = 0;
  let tmax = 1;

  let d = x1 - x0;
  let lo = cx - hx, hi = cx + hx;
  if (d > -1e-9 && d < 1e-9) {
    if (x0 < lo || x0 > hi) return -1;
  } else {
    const inv = 1 / d;
    let t1 = (lo - x0) * inv;
    let t2 = (hi - x0) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  d = y1 - y0;
  lo = cy - hy; hi = cy + hy;
  if (d > -1e-9 && d < 1e-9) {
    if (y0 < lo || y0 > hi) return -1;
  } else {
    const inv = 1 / d;
    let t1 = (lo - y0) * inv;
    let t2 = (hi - y0) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  d = z1 - z0;
  lo = cz - hz; hi = cz + hz;
  if (d > -1e-9 && d < 1e-9) {
    if (z0 < lo || z0 > hi) return -1;
  } else {
    const inv = 1 / d;
    let t1 = (lo - z0) * inv;
    let t2 = (hi - z0) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  return tmin;
}

/**
 * Run the identical fixed step to completion, synchronously.
 *
 * This is how reduced-motion mode resolves a shot: same physics, same RNG, same
 * outcome distribution — the animation is what is removed, not the game. The
 * step cap is there because an unbounded `while (!settled)` in a synchronous
 * function is the other classic way to hang a tab.
 */
export function simulateToSettle(w, rng, maxSteps) {
  const cap = maxSteps | 0 || 900;
  let n = 0;
  while (!w.settled && n < cap) {
    step(w, CONFIG.DT, rng);
    n++;
  }
  if (!w.settled) {
    w.settled = true;
    w.live = false;
    if (w.outcome === OUTCOME.PENDING) {
      w.outcome = OUTCOME.MISS;
      w.flavor = FLAVOR.WIDE;
    }
  }
  return n;
}

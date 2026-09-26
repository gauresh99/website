/**
 * Particle pool and ball trail.
 *
 * Two data structures here, both chosen on purpose:
 *
 * 1. STRUCT OF ARRAYS + FREE-LIST STACK + DENSE ACTIVE LIST.
 *
 *    The obvious implementation is an array of particle objects that gets
 *    pushed to and filtered. That allocates an object per spawn, garbage per
 *    despawn, and a new array per filter — 120 confetti pieces a round becomes
 *    a GC pause at exactly the moment the player is looking at the celebration.
 *
 *    Instead every field is its own Float32Array sized to the cap, allocated
 *    once at mount. A particle is an *index*, not an object. Nothing is ever
 *    allocated or freed at runtime; the arrays are the only memory the system
 *    ever has.
 *
 *    Allocation is a free-list: an Int32Array used as a stack of unused slots,
 *    O(1) to pop and O(1) to push back.
 *
 *    Iteration is a separate dense array of active indices with swap-remove,
 *    so the update loop touches only live particles and never tests a dead
 *    slot. The alternative — walking all `cap` slots and skipping holes — costs
 *    384 branches a frame whether one particle is alive or none are.
 *
 *    The cap is a hard ceiling, not a target. Past it, spawns are dropped. A
 *    device that is already behind must not be handed more work; dropping
 *    confetti is invisible, compounding is not.
 *
 * 2. RING BUFFER for the ball trail.
 *
 *    Fixed length, O(1) write, no shifting, no reallocation. This is the right
 *    structure precisely because the trail only ever needs the last N samples
 *    and explicitly does not want the whole history.
 *
 *    Worth naming the caveat, because it is the same one that bites a ring
 *    buffer used for aggregation: once it wraps, it has silently become "the
 *    recent past" rather than "the run". That is exactly what a motion trail
 *    wants, so here it is correct. Anywhere a total is needed, a ring buffer is
 *    the wrong tool and a running sum is the right one.
 */

import { CONFIG } from './config.js';

export const P_CONFETTI = 0;
export const P_SPARK = 1;
export const P_TURF = 2;
export const P_TRAIL = 3;

export function createParticles(capacity) {
  const cap = capacity | 0;

  // Position and velocity in world space, so particles are depth-projected by
  // the renderer like everything else and sit correctly in the scene.
  const px = new Float32Array(cap);
  const py = new Float32Array(cap);
  const pz = new Float32Array(cap);
  const ox = new Float32Array(cap); // previous position, for interpolation
  const oy = new Float32Array(cap);
  const oz = new Float32Array(cap);
  const vx = new Float32Array(cap);
  const vy = new Float32Array(cap);
  const vz = new Float32Array(cap);
  const life = new Float32Array(cap);
  const maxLife = new Float32Array(cap);
  const size = new Float32Array(cap);
  const spin = new Float32Array(cap);
  const rot = new Float32Array(cap);
  const orot = new Float32Array(cap);
  const kind = new Uint8Array(cap);
  const hue = new Uint8Array(cap); // palette slot, not a colour string

  const free = new Int32Array(cap);
  const active = new Int32Array(cap);
  /** Where each slot sits in `active`, so swap-remove is O(1). */
  const slotPos = new Int32Array(cap);

  let freeTop = cap;
  let activeCount = 0;
  let dropped = 0;

  for (let i = 0; i < cap; i++) {
    free[i] = cap - 1 - i; // pop order 0,1,2,... keeps early frames contiguous
    slotPos[i] = -1;
  }

  /** @returns {number} slot index, or -1 when the pool is exhausted. */
  function alloc() {
    if (freeTop === 0) { dropped++; return -1; }
    const slot = free[--freeTop];
    slotPos[slot] = activeCount;
    active[activeCount++] = slot;
    return slot;
  }

  /** Swap-remove from the dense list, push the slot back on the free stack. */
  function release(denseIndex) {
    const slot = active[denseIndex];
    const last = --activeCount;
    if (denseIndex !== last) {
      const moved = active[last];
      active[denseIndex] = moved;
      slotPos[moved] = denseIndex;
    }
    slotPos[slot] = -1;
    free[freeTop++] = slot;
  }

  /**
   * Fixed-step integration. Gravity and a crude drag; confetti flutters via its
   * own spin. No branching per particle beyond the kind switch, and nothing in
   * here allocates.
   */
  function step(dt, tier) {
    const g = CONFIG.GRAVITY;
    for (let i = activeCount - 1; i >= 0; i--) {
      const s = active[i];
      const l = life[s] - dt;
      if (l <= 0) { release(i); continue; }
      life[s] = l;

      ox[s] = px[s]; oy[s] = py[s]; oz[s] = pz[s];
      orot[s] = rot[s];

      const k = kind[s];
      if (k === P_CONFETTI) {
        // Flutter: confetti loses vertical speed fast and drifts. Cheap
        // approximation, no trig, reads correctly at this size on screen.
        vy[s] -= g * 0.35 * dt;
        vx[s] *= 0.985;
        vz[s] *= 0.985;
        rot[s] += spin[s] * dt;
      } else if (k === P_TRAIL) {
        vx[s] *= 0.9; vy[s] *= 0.9; vz[s] *= 0.9;
      } else {
        vy[s] -= g * dt;
        vx[s] *= 0.97;
        vz[s] *= 0.97;
        rot[s] += spin[s] * dt;
      }

      px[s] += vx[s] * dt;
      py[s] += vy[s] * dt;
      pz[s] += vz[s] * dt;

      if (py[s] < 0.02) {
        py[s] = 0.02;
        vy[s] *= -0.32;
        vx[s] *= 0.7;
        vz[s] *= 0.7;
      }
    }
    // tier is read by the renderer, not here; the simulation cost of a live
    // particle is trivial next to the cost of drawing it.
    void tier;
  }

  /**
   * Spawn a burst. All arguments are numbers — no options object, because an
   * options object per burst is an allocation per burst.
   */
  function burst(x, y, z, count, k, rng, budget) {
    const n = Math.min(count | 0, budget | 0, cap - activeCount);
    for (let i = 0; i < n; i++) {
      const s = alloc();
      if (s < 0) return;
      px[s] = x; py[s] = y; pz[s] = z;
      ox[s] = x; oy[s] = y; oz[s] = z;
      kind[s] = k;
      hue[s] = rng.int(4);
      rot[s] = rng.range(0, 6.283);
      orot[s] = rot[s];

      if (k === P_CONFETTI) {
        const a = rng.range(0, 6.283);
        const sp = rng.range(1.6, 6.4);
        vx[s] = Math.cos(a) * sp * 0.75;
        vy[s] = rng.range(1.4, 6.2);
        vz[s] = Math.sin(a) * sp * 0.5 - 0.6;
        spin[s] = rng.range(-9, 9);
        size[s] = rng.range(0.045, 0.1);
        maxLife[s] = life[s] = rng.range(1.1, 2.3);
      } else if (k === P_TURF) {
        const a = rng.range(0, 6.283);
        const sp = rng.range(0.6, 3.2);
        vx[s] = Math.cos(a) * sp;
        vy[s] = rng.range(0.8, 3.4);
        vz[s] = Math.sin(a) * sp * 0.6;
        spin[s] = rng.range(-6, 6);
        size[s] = rng.range(0.03, 0.075);
        maxLife[s] = life[s] = rng.range(0.4, 0.95);
      } else if (k === P_SPARK) {
        const a = rng.range(0, 6.283);
        const sp = rng.range(2.5, 7.5);
        vx[s] = Math.cos(a) * sp;
        vy[s] = Math.sin(a) * sp * 0.8 + 1.2;
        vz[s] = rng.range(-1.5, -0.2);
        spin[s] = 0;
        size[s] = rng.range(0.02, 0.055);
        maxLife[s] = life[s] = rng.range(0.22, 0.5);
      } else { // P_TRAIL
        vx[s] = rng.range(-0.25, 0.25);
        vy[s] = rng.range(-0.1, 0.35);
        vz[s] = rng.range(-0.4, 0.05);
        spin[s] = 0;
        size[s] = rng.range(0.03, 0.06);
        maxLife[s] = life[s] = rng.range(0.16, 0.34);
      }
    }
  }

  function clear() {
    while (activeCount > 0) release(activeCount - 1);
  }

  return {
    cap,
    px, py, pz, ox, oy, oz, life, maxLife, size, rot, orot, kind, hue,
    active,
    get count() { return activeCount; },
    get dropped() { return dropped; },
    step,
    burst,
    clear,
  };
}

/**
 * Ball trail: a ring buffer of world-space positions.
 *
 * `head` is the next write slot. Reading walks backwards `count` entries, so
 * the newest sample is drawn brightest. Writing is a store and an increment —
 * no shift, no splice, no reallocation, fixed memory forever.
 */
export function createTrail(length) {
  const len = length | 0;
  const tx = new Float32Array(len);
  const ty = new Float32Array(len);
  const tz = new Float32Array(len);
  let head = 0;
  let count = 0;

  return {
    len, tx, ty, tz,
    get head() { return head; },
    get count() { return count; },
    push(x, y, z) {
      tx[head] = x; ty[head] = y; tz[head] = z;
      head = (head + 1) % len;
      if (count < len) count++;
    },
    clear() { head = 0; count = 0; },
  };
}

/**
 * Fixed-timestep loop with interpolated rendering, plus a performance governor.
 *
 * The contract this file exists to honour: physics advances in identical
 * discrete steps regardless of display refresh rate, and the renderer is handed
 * a blend factor so a 144 Hz screen shows smooth motion without running physics
 * at 144 Hz. Glenn Fiedler's "Fix Your Timestep" is the canonical write-up.
 *
 * The part that actually matters for "never hangs the browser" is the
 * accumulator clamp. The failure is a spiral: the tab is backgrounded, rAF
 * stops, 30 s elapse, the first frame back reports a 30000 ms delta, the
 * catch-up loop runs 1800 physics steps, that takes longer than a frame, the
 * next delta is bigger still, and the page locks. Three independent guards stop
 * it, any one of which is sufficient. TWO OF THEM LIVE IN THIS FILE; the third
 * is a lifecycle concern and lives in the scene layer, so look there before
 * assuming it is missing:
 *
 *   1. [index.js] A visibilitychange listener calls resync() so the first frame
 *      after a hidden tab measures from itself, making the delta ~0 rather than
 *      ~30 s. It deliberately does NOT stop the loop — rAF already pauses
 *      itself when hidden, and stopping here would make liveness depend on
 *      receiving an event, which leaves a blank canvas in any tab that was
 *      already hidden at mount.
 *   2. [here, line ~113] The raw delta is clamped to MAX_FRAME_MS before it
 *      reaches the accumulator, covering every case (1) misses — an embedded
 *      frame that never fires visibilitychange, a laptop lid, a debugger
 *      breakpoint, a clock that steps backwards.
 *   3. [here, line ~119] The catch-up loop has a hard step cap and, on hitting
 *      it, *discards* the remaining debt instead of carrying it into the next
 *      frame. Time dilates slightly under sustained overload; it does not
 *      compound.
 *
 * Dropping accumulated time is a deliberate trade. The alternative — staying
 * faithful to wall-clock time — is what causes the spiral. A shootout that runs
 * a few milliseconds of simulation slow on a struggling device is invisible; a
 * frozen tab is not.
 */

import { CONFIG } from './config.js';

/**
 * @param {{ step: (dt: number) => void,
 *           render: (alpha: number, dtMs: number) => void,
 *           onTierChange?: (tier: number) => void }} handlers
 */
export function createLoop(handlers) {
  const stepFn = handlers.step;
  const renderFn = handlers.render;
  const onTierChange = handlers.onTierChange;

  const DT = CONFIG.DT;
  const DT_MS = DT * 1000;

  let rafId = 0;
  let running = false;
  let disposed = false;
  let lastTime = 0;
  let accumulator = 0;
  /** Set after any pause so the next frame measures from itself, not from
   *  whenever the loop last ran. */
  let resync = true;

  // --- Performance governor ------------------------------------------------
  // An exponentially weighted moving average of how long *our* work takes, not
  // of the frame delta. Frame delta conflates our cost with vsync and with
  // whatever else the page is doing; if the browser caps us at 30 Hz on a
  // battery-saving laptop we are not the problem and should not degrade.
  //
  // EWMA rather than a ring buffer of samples: O(1) memory, O(1) update, and
  // the only question being asked is "are we consistently slow", which a
  // smoothed scalar answers. A history buffer would be structure for its own
  // sake here. (The ball trail in particles.js *does* use a ring buffer,
  // because there the actual history is the thing being drawn.)
  let workEwma = 0;
  let tier = 0;                 // 0 full, 1 reduced, 2 minimal
  let overBudgetFrames = 0;
  let underBudgetFrames = 0;
  const TIER_MAX = 2;
  const BUDGET_MS = 10.5;       // our slice of a 16.6 ms frame
  const RECOVER_MS = 5.0;
  const DEGRADE_AFTER = 45;     // ~0.75 s of sustained overrun
  const RECOVER_AFTER = 300;    // ~5 s of comfort before climbing back
  let steps = 0;
  let frames = 0;
  let droppedDebt = 0;

  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame.bind(globalThis)
    : (cb) => setTimeout(() => cb(now()), 16);
  const caf = typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame.bind(globalThis)
    : clearTimeout;

  const perf = (typeof performance === 'object' && performance && typeof performance.now === 'function')
    ? performance
    : null;
  function now() { return perf ? perf.now() : Date.now(); }

  /** The single frame callback. Defined once, never re-created — a closure
   *  allocated per frame is an allocation per frame. */
  function frame(timestamp) {
    if (!running || disposed) return;
    rafId = raf(frame);

    const t0 = typeof timestamp === 'number' ? timestamp : now();

    if (resync) {
      // First frame after a pause, a resize stall or a tab restore.
      lastTime = t0;
      accumulator = 0;
      resync = false;
    }

    let delta = t0 - lastTime;
    lastTime = t0;

    // Guard 2. Also catches a non-monotonic clock, which some virtualised
    // environments genuinely produce.
    if (!(delta > 0)) delta = 0;
    else if (delta > CONFIG.MAX_FRAME_MS) delta = CONFIG.MAX_FRAME_MS;

    accumulator += delta;

    // Guard 3.
    let n = 0;
    while (accumulator >= DT_MS && n < CONFIG.MAX_STEPS_PER_FRAME) {
      stepFn(DT);
      accumulator -= DT_MS;
      n++;
    }
    if (n >= CONFIG.MAX_STEPS_PER_FRAME && accumulator >= DT_MS) {
      droppedDebt += accumulator;
      accumulator = 0;
    }
    steps += n;

    // alpha is how far between the last completed step and the next one we are,
    // so the renderer can blend previous and current state instead of showing
    // the step boundary. Without it a 60 Hz sim on a 144 Hz screen judders.
    renderFn(accumulator / DT_MS, delta);

    frames++;
    const work = now() - t0;
    workEwma += (work - workEwma) * 0.1;

    if (workEwma > BUDGET_MS) {
      underBudgetFrames = 0;
      if (++overBudgetFrames >= DEGRADE_AFTER && tier < TIER_MAX) {
        tier++;
        overBudgetFrames = 0;
        workEwma = 0;
        if (onTierChange) onTierChange(tier);
      }
    } else if (workEwma < RECOVER_MS) {
      overBudgetFrames = 0;
      if (++underBudgetFrames >= RECOVER_AFTER && tier > 0) {
        tier--;
        underBudgetFrames = 0;
        if (onTierChange) onTierChange(tier);
      }
    } else {
      overBudgetFrames = 0;
      underBudgetFrames = 0;
    }
  }

  function start() {
    if (running || disposed) return;
    running = true;
    resync = true;
    rafId = raf(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId) caf(rafId);
    rafId = 0;
  }

  return {
    start,
    stop,
    /** Force the next frame to measure from itself. Call after any stall the
     *  loop could not observe — a long synchronous resize, a restored tab. */
    resync() { resync = true; },
    isRunning() { return running; },
    get tier() { return tier; },
    /** Manual override, used when reduced motion turns effects off wholesale. */
    setTier(t) {
      const next = Math.max(0, Math.min(TIER_MAX, t | 0));
      if (next === tier) return;
      tier = next;
      overBudgetFrames = 0;
      underBudgetFrames = 0;
      if (onTierChange) onTierChange(tier);
    },
    /** Read-only counters. Used by the opt-in debug hook and by nothing else. */
    stats(out) {
      out.frames = frames;
      out.steps = steps;
      out.tier = tier;
      out.workMs = Math.round(workEwma * 100) / 100;
      out.droppedMs = Math.round(droppedDebt);
      return out;
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}

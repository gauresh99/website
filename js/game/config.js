/**
 * Tunables for the shootout, in one place so nothing is a magic number at the
 * call site. World units are metres and seconds throughout; the renderer is the
 * only module that knows about pixels.
 *
 * Real penalty dimensions are used because they cost nothing and make the
 * geometry check itself: if the goal looks wrong on screen, the projection is
 * wrong, not the physics.
 */
export const CONFIG = Object.freeze({
  // --- Simulation -----------------------------------------------------------
  /** Fixed physics step. 60 Hz, not 120: swept collision (see physics.js) makes
   *  the extra rate unnecessary, and halving the step count is the cheapest
   *  thing you can do for a mid-range phone. */
  DT: 1 / 60,
  /** Hard clamp on the frame delta fed to the accumulator. A tab restored after
   *  30 s reports a ~30000 ms delta; without this the while-loop tries 1800
   *  steps in one frame, misses the next vsync, reports an even larger delta,
   *  and hangs the browser. 100 ms is ~6 steps of catch-up, which is generous. */
  MAX_FRAME_MS: 100,
  /** Second, independent guard: never run more than this many steps per frame
   *  even if the clamp above were somehow bypassed. */
  MAX_STEPS_PER_FRAME: 6,

  GRAVITY: 9.81,

  // --- Pitch geometry (metres) ---------------------------------------------
  GOAL_Z: 11.0,        // penalty spot to goal line
  GOAL_HALF_W: 3.66,   // 7.32 m wide
  GOAL_H: 2.44,
  NET_DEPTH: 1.6,
  POST_R: 0.06,
  BALL_R: 0.11,
  SPOT_Y: 0.11,

  // --- Shot -----------------------------------------------------------------
  /** Flight time at power 0 and power 1. Real penalties are ~0.45 s; slowing
   *  that down is a readability decision, not a physics error. */
  FLIGHT_T_SLOW: 0.98,
  FLIGHT_T_FAST: 0.62,
  /** Aim spread in metres at power 0 / power 1. Power buys pace and costs
   *  accuracy, so there is a decision to make and no dominant strategy. */
  SPREAD_MIN: 0.07,
  SPREAD_MAX: 0.46,
  /** How far outside the frame the reticle can travel, so missing is possible. */
  AIM_X_RANGE: 4.35,
  AIM_Y_MIN: 0.16,
  AIM_Y_MAX: 2.95,
  CURVE_MAX: 7.5,      // lateral acceleration, m/s^2

  GROUND_RESTITUTION: 0.55,
  GROUND_FRICTION: 0.9,

  // --- Keeper ---------------------------------------------------------------
  KEEPER_REACT: 0.1,       // seconds before the dive starts
  KEEPER_DIVE_T: 0.52,     // seconds to full extension
  KEEPER_REACH_X: 2.62,    // how far sideways the hands get
  KEEPER_HAND_HX: 0.52,    // hand box half-extents
  KEEPER_HAND_HY: 0.46,
  KEEPER_PLANE_OFF: 0.55,  // hand box sits this far in front of the line
  /** Probability the keeper reads the shot, before the pace penalty. Tuned so a
   *  well-placed corner beats a correct dive — the keeper guessing right is not
   *  the same as the keeper saving it. */
  KEEPER_READ_P: 0.4,

  SETTLE_S: 0.8,           // how long the ball keeps flying after the outcome

  // --- Presentation ---------------------------------------------------------
  PARTICLE_CAP: 384,       // hard ceiling; see particles.js
  TRAIL_LEN: 24,           // ring buffer length
  SHAKE_MAX: 16,           // pixels, tier 0 only

  RESULT_HOLD_S: 1.05,     // commentary beat before the reveal
  /* One panel per project. Penalties themselves are unlimited — this caps the
     number of TARGETS, not the number of attempts. */
  ROUNDS_MAX: 8,
});

/** Outcome codes. Integers in the hot loop, mapped to strings at the boundary. */
export const OUTCOME = Object.freeze({
  PENDING: 0,
  GOAL: 1,
  SAVE: 2,
  MISS: 3,
});

/** Extra colour on the outcome, for commentary and for the renderer. */
export const FLAVOR = Object.freeze({
  NONE: 0,
  WIDE: 1,
  OVER: 2,
  POST: 3,
  BAR: 4,
  HANDS: 5,
});

/** Scene states. Integers for the same reason as above. */
export const STATE = Object.freeze({
  INTRO: 0,
  AIM: 1,
  FLIGHT: 2,
  RESULT: 3,
  REVEAL: 4,
  SUMMARY: 5,
});

/**
 * js/game/index.js — the scene layer.
 *
 * Everything below this file is generic: physics knows about a ball and a
 * keeper, the renderer knows about metres and pixels, the loop knows about
 * time. None of them know what a "project" is. This file is the only place
 * where the simulation and the CV meet, and it exists to keep that seam in one
 * readable place rather than smeared through the engine.
 *
 * WHAT A ROUND IS
 * Round n is project n. Five projects, five penalties, in content order. The
 * shot decides the celebration; the reveal happens either way. That is not a
 * nicety — it is the reason this mode is allowed to exist at all on a page
 * somebody might be reading because they are deciding whether to interview its
 * author. A game that could withhold a paragraph of a résumé behind a missed
 * penalty would be a worse way to publish a résumé, however good the game was.
 *
 * THE SHAPE OF THE FLOW
 *   AIM -> FLIGHT -> RESULT -> REVEAL -> (next round) ... -> SUMMARY
 * with two doors out of every one of those states: the exit button in the HUD
 * bar, and Escape (handled by main.js). reveal(index) is a third door, inward:
 * it lands on any project's content from any state, which is what makes the
 * game skippable per-section rather than only wholesale.
 *
 * REDUCED MOTION IS A DIFFERENT SEQUENCE, NOT A SLOWER ONE
 * Under prefers-reduced-motion the loop still runs, because it is also the
 * input pump, but three things change and they change together:
 *   - physics.step() is never called while aiming, so the keeper does not sway
 *     and nothing on screen moves by itself;
 *   - the shot resolves through physics.simulateToSettle(), synchronously, so
 *     the ball never travels across the screen — same physics, same RNG, same
 *     outcome distribution, no flight;
 *   - the canvas is repainted only when something the player did changed it
 *     (a `dirty` flag), and draw() is passed still=true, which suppresses
 *     shake, glow, trail and particles inside the renderer.
 * The result is a still image that changes when, and only when, the player
 * changes it. The reticle still tracks a held arrow key, because that is
 * direct manipulation of a control — the same class of movement as a mouse
 * cursor or a slider thumb — and removing it would make the game unplayable
 * for the exact keyboard user the setting is meant to help.
 */

import { text } from '../sanitize.js';
import { createTargets, resetTargets, hitTest, firstStanding, standingCount } from './targets.js';
import { CONFIG, OUTCOME, STATE } from './config.js';
import { createRng, createBag, hashString } from './rng.js';
import { createLoop } from './loop.js';
import { createWorld, resetRound, launch, step as stepWorld, simulateToSettle,
  EV_BOUNCE, EV_NET, EV_WOOD, EV_SAVE } from './physics.js';
import { createParticles, createTrail, P_CONFETTI, P_SPARK, P_TURF } from './particles.js';
import { createInput } from './input.js';
import { createRenderer } from './renderer.js';
import { createHud, outcomeWord, zoneToAim } from './hud.js';

/** One live instance per root, so a remount cannot leave the previous one
 *  running against a detached tree. Mirrors site.js. */
const INSTANCES = new WeakMap();

/** Reticle travel, metres per second, for held keys. */
const AIM_SPEED_X = 4.6;
const AIM_SPEED_Y = 2.6;
const POWER_SPEED = 0.8;

/** Defaults a round starts from: dead centre, just inside comfortable. */
const AIM_HOME_X = 0;
const AIM_HOME_Y = 1.05;
const POWER_HOME = 0.55;

/**
 * The stylesheet is injected rather than linked from index.html because
 * index.html belongs to the UI agent and is finished. A same-origin <link> is
 * what the deployed CSP allows: `style-src 'self'` admits this file and would
 * reject an inline <style> element, so this is the only available route and
 * also the correct one.
 *
 * It is added once per document and deliberately NOT removed on destroy. The
 * rules only match `.gm-*` nodes, which stop existing the moment the game
 * unmounts, so leaving it costs nothing — while removing and re-adding it on
 * every mode toggle would re-enter the stylesheet's load cycle and flash an
 * unstyled HUD each time the visitor switched back.
 */
const STYLE_ID = 'gm-game-css';

/** @returns {() => void} a disposer for the readiness listener. */
function ensureStylesheet(onReady) {
  let link = document.getElementById(STYLE_ID);

  if (!link) {
    link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    // Resolved against this module's own URL, not the document's, so the game
    // keeps working if the site is ever served from a subpath.
    link.href = new URL('../../css/game.css', import.meta.url).href;
    // The element carries its own loaded flag so a later mount can tell
    // "already applied" from "still in flight" without issuing a second
    // request or guessing.
    link.addEventListener('load', () => { link.dataset.loaded = 'true'; }, { once: true });
    document.head.append(link);
  }

  if (link.dataset.loaded === 'true') {
    onReady();
    return () => {};
  }
  link.addEventListener('load', onReady, { once: true });
  return () => link.removeEventListener('load', onReady);
}

/**
 * @param {HTMLElement} root
 * @param {object} content
 * @param {{reducedMotion?: boolean, onExit?: () => void,
 *          onReveal?: (id: string) => void,
 *          announce?: (message: string) => void}} [opts]
 * @returns {{ destroy(): void, reveal(index: number): void }}
 */
export function mountGame(root, content, opts) {
  // Idempotent: main.js swaps modes by remounting, and a second live instance
  // on one root would mean two rAF loops and two sets of key handlers.
  INSTANCES.get(root)?.destroy();

  const options = opts || {};
  const onExit = typeof options.onExit === 'function' ? options.onExit : null;
  const onReveal = typeof options.onReveal === 'function' ? options.onReveal : null;
  const speak = typeof options.announce === 'function' ? options.announce : null;

  const data = content || {};
  const allProjects = Array.isArray(data.projects) ? data.projects : [];
  const rounds = Math.min(CONFIG.ROUNDS_MAX, allProjects.length);
  const projects = allProjects.slice(0, rounds);

  let reduced = options.reducedMotion === true;

  /* --- listener bookkeeping ------------------------------------------------
   * Everything registered through on() or track() is released in destroy(),
   * which is one sweep over one array. The alternative — a named remove for
   * each listener — is the version where the sixth listener added six months
   * later quietly leaks. */
  const cleanups = [];
  function on(node, type, fn, opt) {
    node.addEventListener(type, fn, opt);
    cleanups.push(() => node.removeEventListener(type, fn, opt));
  }
  function track(fn) { cleanups.push(fn); }

  /* --- DOM scaffold -------------------------------------------------------- */

  const stage = document.createElement('div');
  stage.className = 'gm-root';
  stage.dataset.motion = reduced ? 'still' : 'play';

  const canvas = document.createElement('canvas');
  canvas.className = 'gm-canvas';
  // The canvas duplicates no information; every number and every word on it
  // also exists in the HUD as real text. Hiding it from the accessibility tree
  // is therefore accurate rather than lossy, and it stops a screen reader
  // announcing an unlabelled graphic on every reveal.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');

  stage.append(canvas);
  root.dataset.view = 'shootout';
  root.replaceChildren(stage);

  /* --- engine -------------------------------------------------------------- */

  const rng = createRng(hashString('shootout'));
  const world = createWorld();
  const particles = createParticles(CONFIG.PARTICLE_CAP);
  const trail = createTrail(CONFIG.TRAIL_LEN);
  const renderer = createRenderer(canvas, stage);

  // Same number the header shows: the shirt on the pitch and the one in the
  // header must agree, so both read it from the one source.
  // Greet the player by squad number, in the banner over the pitch.
  import('../visitors.js')
    .then((m) => m.getPlayerNumber())
    .then((r) => {
      if (r && r.number != null) {
        hud.setPlayerNumber(r.number);
        hud.setBanner(`Welcome, Player ${r.number}`, 'neutral');
      }
    })
    .catch(() => { /* no number, no greeting */ });

  const commentary = data.commentary || {};
  const lines = {
    goal: Array.isArray(commentary.goal) ? commentary.goal : [],
    miss: Array.isArray(commentary.miss) ? commentary.miss : [],
    save: Array.isArray(commentary.save) ? commentary.save : [],
  };
  const bags = {
    goal: createBag(lines.goal.length, rng),
    miss: createBag(lines.miss.length, rng),
    save: createBag(lines.save.length, rng),
  };

  /** Draw a commentary line without repeating until the deck is exhausted. */
  function drawLine(key) {
    const bag = bags[key];
    const pool = lines[key];
    if (!bag || !pool.length) return '';
    const index = bag.draw();
    return index >= 0 ? pool[index] : '';
  }

  /* --- scene state --------------------------------------------------------- */

  let state = STATE.AIM;
  let round = 0;
  let goals = 0;

  /**
   * The panels in the goal mouth. `round` is still the attempt counter, but it
   * no longer decides which project opens — the panel you hit does. Aiming is
   * the navigation.
   */
  const targets = createTargets(projects.length);
  for (let i = 0; i < targets.length; i++) {
    targets[i].label = projects[i] ? textOf(projects[i].short || projects[i].name) : '';
  }
  /** Panel opened by the current shot; -1 until the ball crosses. */
  let struck = -1;
  /** Did the last shot go in? Drives reveal-vs-retry. */
  let scoredThisShot = false;
  let attempt = 0;          // increments on replay, so a second run differs
  let holdTimer = 0;
  let finished = false;
  let returnToSummary = false;
  let destroyed = false;
  let dirty = true;         // reduced-motion repaint flag

  const results = [];
  for (let i = 0; i < rounds; i++) {
    results.push({ outcome: OUTCOME.PENDING, flavor: 0, name: '', id: '' });
  }

  /** Reused by the pointer unprojection. One object for the whole mount. */
  const scratchAim = { x: 0, y: 0 };

  /* --- input --------------------------------------------------------------- */

  // Keys are bound to the game root, not to window. #app-root already carries
  // tabindex="-1" (index.html), so it can hold focus, and scoping the listener
  // to it means the arrow keys are the game's only while the game has focus —
  // and are the browser's scroll keys again the moment focus leaves.
  const input = createInput(root, canvas, {
    onSkip: () => { if (onExit) onExit(); },
  });
  track(() => input.destroy());

  const hud = createHud(stage, {
    zones: input.ZONES,
    onZone: (index) => { input.pressZone(index); },
    onPower: (value) => { setPower(value); },
    onShoot: () => { input.pressConfirm(); },
    onNext: () => { advance(); },
    onReplay: () => { restart(); },
    onExit: () => { if (onExit) onExit(); },
    onJump: (index) => { api.reveal(index); },
  });
  track(() => hud.destroy());

  hud.setRounds(rounds);

  /* --- aim ----------------------------------------------------------------- */

  function clampAim() {
    const x = world.aimX;
    const y = world.aimY;
    world.aimX = x < -CONFIG.AIM_X_RANGE ? -CONFIG.AIM_X_RANGE
      : (x > CONFIG.AIM_X_RANGE ? CONFIG.AIM_X_RANGE : x);
    world.aimY = y < CONFIG.AIM_Y_MIN ? CONFIG.AIM_Y_MIN
      : (y > CONFIG.AIM_Y_MAX ? CONFIG.AIM_Y_MAX : y);
  }

  function setPower(value) {
    const v = value < 0 ? 0 : (value > 1 ? 1 : value);
    if (v === world.power) return;
    world.power = v;
    dirty = true;
  }

  /**
   * Keypad zone -> metres. The mapping itself lives in hud.js next to its own
   * inverse, so the grid cell the HUD highlights and the point the ball is
   * aimed at can never disagree.
   */
  function applyZone(index) {
    if (!zoneToAim(input.ZONES, index, scratchAim)) return;
    world.aimX = scratchAim.x;
    world.aimY = scratchAim.y;
    clampAim();
    dirty = true;
  }

  /* --- round lifecycle ------------------------------------------------------ */

  function projectAt(index) {
    return projects[index] || null;
  }

  /** Recover which project a finished attempt revealed, by its recorded id. */
  function indexOfResult(resultIndex) {
    const row = results[resultIndex];
    if (!row || !row.id) return firstStanding(targets);
    for (let i = 0; i < projects.length; i++) {
      if (textOf(projects[i].id) === row.id) return i;
    }
    return firstStanding(targets);
  }

  /** Summary rows are attempts; the card they reopen is recorded by project id. */
  function projectIndexForResult(resultIndex) {
    const row = results[resultIndex];
    if (row && row.id) {
      for (let i = 0; i < projects.length; i++) {
        if (textOf(projects[i].id) === row.id) return i;
      }
    }
    if (!projects.length) return -1;
    return Math.max(0, Math.min(projects.length - 1, resultIndex | 0));
  }

  function beginRound(index) {
    round = rounds > 0 ? Math.max(0, Math.min(rounds - 1, index | 0)) : 0;
    state = STATE.AIM;
    holdTimer = 0;

    resetRound(world);
    particles.clear();
    trail.clear();

    world.aimX = AIM_HOME_X;
    world.aimY = AIM_HOME_Y;
    world.power = POWER_HOME;
    world.curve = 0;

    // Deterministic per project and per attempt: the same project on the same
    // run always behaves the same way, and a replay is a different run. That is
    // what makes the engine's "seed plus inputs reproduces it" claim testable
    // rather than decorative.
    const project = projectAt(round);
    const seed = hashString(project ? project.id : `round-${round}`);
    rng.seed((seed + attempt * 0x9e3779b1) >>> 0);

    hud.setRound(round);
    hud.setPhase('aim');
    hud.setCommentary(
      project
        ? `Penalty ${round + 1} of ${rounds}. On the spot for ${textOf(project.name)}.`
        : `Penalty ${round + 1} of ${rounds}.`,
      ''
    );
    hud.setAim(world.aimX, world.aimY, world.power);
    dirty = true;
  }

  /**
   * Every content string that leaves this module goes through here.
   *
   * Most of them end up at hud.js, which sanitises again at its own boundary,
   * so this is belt-and-braces for those. It is NOT redundant for the
   * announcement path: revealSentence() builds a string that goes straight to
   * opts.announce and into the page's live region without passing through the
   * HUD at all. A bare `typeof value === 'string'` check would let a bidi
   * override or a C1 control reach a screen reader, which is exactly the class
   * of thing sanitize.text() exists to strip.
   */
  function textOf(value) {
    return text(value);
  }

  function shoot() {
    if (state !== STATE.AIM) return;
    state = STATE.FLIGHT;
    hud.setPhase('flight');
    hud.setCommentary('Struck.', '');
    trail.clear();
    launch(world, world.aimX, world.aimY, world.power, world.curve, rng);

    if (reduced) {
      // Same step function, run to completion with no frames in between.
      simulateToSettle(world, rng, 900);
      resolveShot();
    }
    dirty = true;
  }

  /** The shot has settled. Record it, say something, hold a beat. */
  function resolveShot() {
    /*
     * Which panel did it hit? Only a goal can knock one out — a save or a miss
     * never reached the plane. A goal that threads a gap between panels is a
     * legitimate goal; it just opens the next panel still standing rather than
     * nothing, so a good finish is never punished with an empty screen.
     */
    struck = -1;
    if (world.outcome === OUTCOME.GOAL) {
      /*
       * crossX/crossY, not bx/by. The physics interpolates the exact point the
       * ball passed through the goal plane; bx/by by this point is where it
       * came to rest, which is in the net and on the floor. Using the settled
       * position tested the panel layout against a spot the ball was never at,
       * and opened whichever project happened to sit low and left.
       */
      struck = hitTest(targets, world.crossX, world.crossY, CONFIG.BALL_R);
      if (struck < 0) struck = firstStanding(targets);
      if (struck >= 0) {
        targets[struck].down = true;
        targets[struck].anim = 0;
      }
    }

    // The project shown is the panel that went down. On a save or a miss there
    // is no panel, so fall back to the first one still standing: the content
    // rule is that every attempt reveals something, regardless of outcome.
    const shown = struck >= 0 ? struck : firstStanding(targets);
    const project = projectAt(shown >= 0 ? shown : round);
    const row = results[round];
    if (row) {
      row.outcome = world.outcome;
      row.flavor = world.flavor;
      row.name = project ? textOf(project.name) : '';
      row.id = project ? textOf(project.id) : '';
    }
    if (world.outcome === OUTCOME.GOAL) goals++;

    hud.setPip(round, world.outcome, world.flavor);
    hud.setScore(goals);

    const key = world.outcome === OUTCOME.GOAL ? 'goal'
      : (world.outcome === OUTCOME.SAVE ? 'save' : 'miss');
    const line = drawLine(key);
    hud.setCommentary(line, outcomeWord(world.outcome, world.flavor));

    // A save or a miss does not open the panel. The panel is still standing,
    // so the next shot can go for it again — and the written version is always
    // reachable, so no content is ever actually locked behind a shot.
    scoredThisShot = world.outcome === OUTCOME.GOAL;
    hud.setBanner(
      scoredThisShot ? 'Score! Good shot' : 'Try again!',
      scoredThisShot ? 'goal' : 'save',
    );

    state = STATE.RESULT;
    hud.setPhase('result');
    // Under reduced motion there is no flight to watch, so there is nothing for
    // a commentary beat to sit over; the reveal follows immediately.
    holdTimer = reduced ? 0 : CONFIG.RESULT_HOLD_S;
    if (reduced) { scoredThisShot ? enterReveal(line) : retryInline(); }
    dirty = true;
  }

  /**
   * Show the card.
   *
   * The announcement is assembled here as ONE string. Two calls to announce()
   * inside the same tick would clobber each other in the live region and a
   * screen reader would hear half of each. onReveal() is called first because
   * main.js implements it as an announcement of its own: calling it first and
   * announcing after means the richer sentence is what survives.
   */
  /**
   * A save or a miss.
   *
   * No panel. Opening a full-screen card to say "you missed" interrupts the
   * thing the player is in the middle of doing, and there is nothing on that
   * card worth the interruption. The banner says it and the next penalty is
   * already live — the panel is still standing, so the same target is there to
   * go at again.
   */
  function retryInline() {
    hud.setBanner('Try again!', 'save');
    hud.hideReveal();
    beginRound(round);
    refocusStage();
    dirty = true;
  }

  function enterReveal(line) {
    // The panel that went down, not the attempt number — you opened this by
    // hitting it. `struck` is -1 on a save or a miss, where projectAt falls
    // back to whatever resolveShot already picked for the row.
    const shown = struck >= 0 ? struck : indexOfResult(round);
    const project = projectAt(shown);
    state = STATE.REVEAL;
    hud.setPhase('reveal');

    // What "next" means depends on how the player got here: mid-run it is the
    // following penalty, at the end it is full time, and after a jump from the
    // summary it is the way back to the summary. The button must say which.
    const nextLabel = returnToSummary ? 'Back to the summary'
      : (standingCount(targets) === 0 ? 'See the summary' : 'Next penalty');

    const heading = hud.showReveal(
      project, round, world.outcome, world.flavor, line, nextLabel, reduced
    );

    if (project && onReveal) onReveal(textOf(project.id));
    if (speak) speak(revealSentence(project, line));
    focusPanel(heading);
    dirty = true;
  }

  /** The spoken version of a reveal: outcome, commentary, then the payoff. */
  function revealSentence(project, line) {
    const parts = [];
    // A jumped-to round has no outcome, and its outcomeWord is already
    // "Revealed" — leading with it would announce "Revealed. Revealed: Warret".
    if (world.outcome !== OUTCOME.PENDING) {
      parts.push(`${outcomeWord(world.outcome, world.flavor)}.`);
    }
    const said = textOf(line);
    if (said) parts.push(said);
    if (project) {
      const name = textOf(project.name);
      if (name) parts.push(`Revealed: ${name}.`);
      const highlight = project.highlight || {};
      const label = textOf(highlight.label);
      const detail = textOf(highlight.text);
      if (label && detail) parts.push(`${label}: ${detail}`);
      else if (detail) parts.push(detail);
    }
    return parts.join(' ');
  }

  /** Leave the reveal: next penalty, or full time. */
  function advance() {
    if (state !== STATE.REVEAL) return;
    hud.hideReveal();

    if (returnToSummary) {
      returnToSummary = false;
      enterSummary();
      return;
    }
    // Penalties are unlimited. The run ends when every panel has been knocked
    // down, not after a fixed count — a missed shot costs you nothing but
    // another go, which is the whole point of letting people retake.
    if (standingCount(targets) === 0) {
      enterSummary();
      return;
    }
    beginRound(round + 1);
    refocusStage();
  }

  function enterSummary() {
    finished = true;
    state = STATE.SUMMARY;
    hud.setPhase('summary');
    const heading = hud.showSummary(results, goals, rounds, reduced);
    if (speak) {
      speak(`Full time. ${goals} scored from ${rounds}. All ${rounds} projects were revealed and can be reopened from the summary.`);
    }
    focusPanel(heading);
    dirty = true;
  }

  function restart() {
    hud.hideSummary();
    hud.hideReveal();
    attempt++;
    goals = 0;
    finished = false;
    returnToSummary = false;
    for (let i = 0; i < results.length; i++) {
      results[i].outcome = OUTCOME.PENDING;
      results[i].flavor = 0;
      results[i].name = '';
      results[i].id = '';
    }
    hud.resetPips();
    hud.setScore(0);
    // Every panel goes back up for a new run.
    resetTargets(targets);
    struck = -1;
    beginRound(0);
    refocusStage();
    if (speak) speak('New shootout. Five penalties.');
  }

  /* --- focus ---------------------------------------------------------------
   * A panel that appears without taking focus is a panel a keyboard user has to
   * hunt for; one that takes focus and never gives it back is a trap. Both ends
   * are handled here and nowhere else. */

  function focusPanel(node) {
    if (!node || typeof node.focus !== 'function') return;
    try { node.focus({ preventScroll: true }); } catch { node.focus(); }
  }

  function refocusStage() {
    if (typeof root.focus !== 'function') return;
    try { root.focus({ preventScroll: true }); } catch { root.focus(); }
  }

  /* --- the fixed step ------------------------------------------------------- */

  function consumeInput(dt) {
    const s = input.state;

    // Latches first, and exactly once each: a zone chosen by key or by button
    // is the same event by the time it gets here.
    const zone = input.takeZone();
    if (zone >= 0 && state === STATE.AIM) applyZone(zone);

    if (input.takePointerAim() && state === STATE.AIM && renderer.ok) {
      if (renderer.unprojectToGoal(s.pointerX, s.pointerY, scratchAim)) {
        world.aimX = scratchAim.x;
        world.aimY = scratchAim.y;
        clampAim();
        dirty = true;
      }
    }

    if (state === STATE.AIM) {
      if (s.aimDX !== 0 || s.aimDY !== 0) {
        world.aimX += s.aimDX * AIM_SPEED_X * dt;
        world.aimY += s.aimDY * AIM_SPEED_Y * dt;
        clampAim();
        dirty = true;
      }
      if (s.powerD !== 0) setPower(world.power + s.powerD * POWER_SPEED * dt);
    }

    if (input.takeConfirm()) {
      if (state === STATE.AIM) shoot();
      else if (state === STATE.RESULT) { holdTimer = 0; }
      else if (state === STATE.REVEAL) advance();
      // SUMMARY is deliberately inert: restarting a finished run should take a
      // deliberate press of a named button, not a stray space bar.
    }
  }

  /** Particle and camera reactions to what the physics just reported. */
  function reactToEvents() {
    const events = world.events;
    if (!events || reduced) return;

    if (events & EV_SAVE) {
      particles.burst(world.contactX, world.contactY, world.contactZ, 16, P_SPARK, rng, 16);
    }
    if (events & EV_WOOD) {
      particles.burst(world.crossX, world.crossY, CONFIG.GOAL_Z, 14, P_SPARK, rng, 14);
    }
    if (events & EV_BOUNCE) {
      particles.burst(world.bx, 0.02, world.bz, 8, P_TURF, rng, 8);
    }
    if (events & EV_NET) {
      // The celebration. Budgeted, and dropped entirely by the pool if the
      // device is already behind — confetti is the first thing that should go.
      particles.burst(world.crossX, world.crossY, CONFIG.GOAL_Z + 0.3, 96, P_CONFETTI, rng, 96);
    }
  }

  function step(dt) {
    consumeInput(dt);

    // Knocked-out panels fall away over ~0.5 s. Advancing this here rather
    // than in the renderer keeps the renderer a pure function of state, and
    // costs one pass over five objects with no allocation.
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.down && t.anim < 1) {
        t.anim = Math.min(1, t.anim + dt * 2);
        dirty = true;
      }
    }

    if (state === STATE.AIM) {
      // Reduced motion: no physics tick at all while aiming, so the keeper is
      // still and the scene holds a single frame.
      if (!reduced) stepWorld(world, dt, rng);
      hud.setAim(world.aimX, world.aimY, world.power);
      return;
    }

    if (state === STATE.FLIGHT) {
      stepWorld(world, dt, rng);
      reactToEvents();
      if (world.live && !world.settled) trail.push(world.bx, world.by, world.bz);
      particles.step(dt, 0);
      if (world.settled) resolveShot();
      return;
    }

    if (state === STATE.RESULT) {
      // Keep integrating: the ball is still rolling into the net and the shake
      // is still decaying while the commentary beat plays.
      if (!reduced) {
        stepWorld(world, dt, rng);
        reactToEvents();
        particles.step(dt, 0);
      }
      holdTimer -= dt;
      if (holdTimer <= 0) { scoredThisShot ? enterReveal(lastLine()) : retryInline(); }
      return;
    }

    // REVEAL and SUMMARY: the world keeps settling underneath the panel so the
    // confetti finishes falling rather than freezing mid-air.
    if (!reduced) {
      stepWorld(world, dt, rng);
      particles.step(dt, 0);
    }
  }

  /** The commentary currently on screen, so the reveal ribbon repeats it. */
  let currentLine = '';
  function lastLine() { return currentLine; }

  // Wrap the HUD setter once so currentLine tracks it without a second source
  // of truth.
  const hudSetCommentary = hud.setCommentary.bind(hud);
  hud.setCommentary = (line, badge) => {
    currentLine = typeof line === 'string' ? line : '';
    hudSetCommentary(line, badge);
  };

  /* --- render --------------------------------------------------------------- */

  function render(alpha) {
    if (!renderer.ok || renderer.lost) return;
    // Under reduced motion the canvas is a still: repaint only when something
    // the player did has changed it.
    if (reduced) {
      if (!dirty) return;
      dirty = false;
    }
    const showAim = state === STATE.AIM;
    renderer.draw(world, particles, trail, reduced ? 1 : alpha, loop.tier, showAim, reduced, targets);
  }

  const loop = createLoop({ step, render });

  /* --- sizing ---------------------------------------------------------------
   * The renderer owns pixels and the simulation owns metres, so a resize is a
   * new projection over an unchanged world. Nothing needs to be paused, and the
   * ball does not move. The only thing that must happen is a resync, because a
   * long synchronous layout is exactly the kind of stall the loop cannot see. */

  function syncSize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    loop.resync();
    dirty = true;
  }

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(syncSize);
    ro.observe(stage);
    track(() => ro.disconnect());
  }
  // Also on window resize: a move between monitors changes devicePixelRatio
  // without necessarily changing the element's CSS box.
  on(window, 'resize', syncSize);

  /* --- theme, motion, visibility -------------------------------------------- */

  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;

  if (darkQuery?.addEventListener) {
    on(darkQuery, 'change', () => {
      renderer.refreshPalette();
      dirty = true;
    });
  }

  // Honouring the setting when it changes mid-visit, not only at mount.
  if (motionQuery?.addEventListener) {
    on(motionQuery, 'change', (event) => {
      reduced = event.matches === true;
      stage.dataset.motion = reduced ? 'still' : 'play';
      if (reduced) {
        particles.clear();
        trail.clear();
        world.shake = 0;
        world.flash = 0;
        // A shot already in the air finishes instantly rather than continuing
        // to fly under a setting that now says it should not.
        if (state === STATE.FLIGHT) {
          simulateToSettle(world, rng, 900);
          resolveShot();
        }
      }
      loop.resync();
      dirty = true;
    });
  }

  /**
   * Guard 1 from loop.js's header comment, implemented here.
   *
   * loop.js documents three independent defences against the backgrounded-tab
   * spiral and implements two of them — the frame-delta clamp and the step cap
   * — either of which is on its own sufficient. The third, resynchronising
   * across a hidden tab, is a lifecycle concern rather than a timing one, and
   * it belongs to whoever owns teardown: a document-level listener inside
   * loop.js would have no path out of the page when the loop is disposed. So
   * it lives here, where destroy() already sweeps it.
   *
   * NOTE ON WHAT THIS DELIBERATELY DOES NOT DO. An earlier version stopped the
   * loop on hidden and started it on visible, which is the obvious shape and
   * is wrong: it makes the game's liveness depend on receiving an event. A
   * page mounted while already hidden — opened in a background tab, restored
   * into the background by a session manager, or running in an embedding whose
   * visibilityState never reports visible — would stop before it ever painted
   * and have no way back. That failure is a black rectangle where the pitch
   * should be.
   *
   * So the loop is simply never stopped here. requestAnimationFrame already
   * pauses itself in a hidden tab, which is the saving this was reaching for,
   * and it resumes on its own without being told. resync() on EVERY
   * transition — in both directions, so a missed 'visible' event cannot
   * matter — is the part that actually needs doing: it makes the first frame
   * back measure from itself, so the accumulator never sees the thirty seconds
   * that passed.
   */
  on(document, 'visibilitychange', () => {
    if (destroyed) return;
    loop.resync();
    if (document.visibilityState === 'visible') {
      loop.start(); // a no-op if it is already running
      dirty = true;
    }
  });

  /* --- go -------------------------------------------------------------------- */

  track(ensureStylesheet(() => {
    if (destroyed) return;
    // The renderer samples --gm-* off the stage element; until the stylesheet
    // has arrived those resolve to its built-in fallbacks, so re-read them once
    // the real palette exists.
    renderer.refreshPalette();
    syncSize();
    dirty = true;
  }));

  syncSize();
  beginRound(0);
  refocusStage();

  // Paint one frame synchronously before any rAF has had a chance to fire, so
  // the pitch is on screen the instant the stage exists. Without this the
  // canvas is blank until the first animation frame, which is merely a flicker
  // on a visible tab and is permanent on a tab that is never visible at all.
  render(1);

  // Started unconditionally: see the visibilitychange note above.
  loop.start();

  /* --- public API ------------------------------------------------------------ */

  const api = {
    /**
     * Jump straight to a section's content, from any state.
     *
     * This is the per-section escape hatch: a visitor who wants project four
     * and does not want to take three penalties first gets project four. A
     * round reached this way is marked as revealed-not-played, which is a
     * distinct pip state — the scoreboard should not claim a goal that was
     * never taken, and it should not claim a miss either.
     */
    reveal(index) {
      if (destroyed) return;
      const resultIndex = Math.max(0, Math.min(rounds - 1, index | 0));
      const projectIndex = projectIndexForResult(resultIndex);

      // Whatever was in the air is over.
      world.live = false;
      world.settled = true;
      particles.clear();
      trail.clear();

      returnToSummary = finished;
      round = resultIndex;
      hud.setRound(resultIndex);
      hud.hideSummary();

      const row = results[resultIndex];
      const played = row && row.outcome !== OUTCOME.PENDING;
      world.outcome = played ? row.outcome : OUTCOME.PENDING;
      world.flavor = played ? row.flavor : 0;

      const project = projectAt(projectIndex);
      if (project && row && !row.name) {
        row.name = textOf(project.name);
        row.id = textOf(project.id);
      }
      struck = projectIndex;

      const line = played ? currentLine : '';
      hud.setCommentary(
        played ? line : 'Jumped straight to the written version of this one.',
        played ? outcomeWord(row.outcome, row.flavor) : ''
      );
      enterReveal(played ? line : '');
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;

      // Order matters: stop time first, so nothing can run against half-torn
      // state while the rest comes down.
      loop.dispose();
      renderer.dispose();

      while (cleanups.length) {
        const dispose = cleanups.pop();
        try { dispose(); } catch { /* a failed cleanup must not block the rest */ }
      }

      particles.clear();
      trail.clear();

      delete root.dataset.view;
      root.replaceChildren();
      if (INSTANCES.get(root) === api) INSTANCES.delete(root);
    },
  };

  INSTANCES.set(root, api);
  return api;
}

export default mountGame;

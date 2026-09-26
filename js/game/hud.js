/**
 * js/game/hud.js — the DOM overlay that sits over the canvas.
 *
 * This file owns every pixel of the shootout that is TEXT, and the canvas owns
 * every pixel that is PICTURE. That split is the whole accessibility strategy:
 * the canvas is marked aria-hidden and carries no information that does not
 * also exist here as real DOM. Score, round, aim, power, the commentary line
 * and the revealed project are all readable, focusable, selectable nodes. If
 * the canvas never acquires a context (blocked, out of memory, a privacy
 * extension), the game is still completely playable from this layer alone.
 *
 * THREE RULES THIS FILE KEEPS
 *
 * 1. NO CONTENT STRING REACHES THE DOM EXCEPT AS A TEXT NODE. Every value out
 *    of content.js goes through sanitize.text(), every URL through safeHref().
 *    There is no innerHTML path here — not for content, not even for the
 *    static markup this file authors, because the deployed CSP sets
 *    `require-trusted-types-for 'script'`, which makes an innerHTML assignment
 *    throw at runtime in browsers that enforce it. createElement is not a
 *    stylistic preference on this site; it is the only thing that works.
 *
 * 2. NO DOM WRITE PER FRAME. The scene calls setAim() on every one of its 60
 *    steps a second. Writing textContent each time would mean 60 style
 *    recalculations a second racing the canvas for the same 16 ms. Every
 *    setter here compares against the last value it wrote and returns early
 *    when nothing changed, so a held arrow key touches the DOM only when the
 *    human-readable aim label actually changes — a few times per shot.
 *
 * 3. THE REVEAL IS NEVER GATED. showReveal() renders the same content whether
 *    the shot was a goal, a save, a miss or was skipped entirely. The outcome
 *    changes the ribbon, the ordering of the fanfare and whether the flip-in
 *    plays. It does not change what is present.
 *
 * THE CARD IS NOT MINE. `.proj-card` is a DOM contract published by the UI
 * agent in css/site.css ("designed to stand alone ... the game can build the
 * same tree and get the same card"). Building that exact tree rather than a
 * game-specific card means the revealed project is typeset by the same rules
 * as the written site, inherits dark mode and reduced motion for free, and
 * cannot drift from it.
 */

import { playerFigure } from './art.js';
import { text, safeHref } from '../sanitize.js';
import { CONFIG, OUTCOME, FLAVOR } from './config.js';

/* --- DOM helpers ---------------------------------------------------------- */

/**
 * Build an element. `text` is assigned with textContent and never parsed.
 * Attribute names and literal strings are authored in this file; any value
 * that came from content.js is pre-sanitised by the caller.
 */
function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

/** Sanitised string, or '' for anything unusable. */
function t(value) {
  const out = text(value);
  return typeof out === 'string' ? out : '';
}

/** An array of non-empty sanitised strings. */
function list(value) {
  return Array.isArray(value) ? value.map(t).filter(Boolean) : [];
}

/** Content ids become DOM ids and data attributes; hold them to a strict
 *  alphabet rather than trusting text() alone, exactly as site.js does. */
function slug(value, fallback) {
  const cleaned = t(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/* --- outcome vocabulary --------------------------------------------------- */

/**
 * One place that turns the simulation's integer outcome into words. The
 * renderer, the commentary bag and the scoreboard all key off the same two
 * integers, so the only string mapping lives here.
 */
function outcomeWord(outcome, flavor) {
  if (outcome === OUTCOME.GOAL) return 'Goal';
  if (outcome === OUTCOME.SAVE) return 'Saved';
  if (outcome === OUTCOME.MISS) {
    switch (flavor) {
      case FLAVOR.WIDE: return 'Wide';
      case FLAVOR.OVER: return 'Over';
      case FLAVOR.POST: return 'Off the post';
      case FLAVOR.BAR:  return 'Off the bar';
      default: return 'Missed';
    }
  }
  return 'Revealed';
}

/** Coarse state for styling and for the pips. */
function outcomeKey(outcome) {
  if (outcome === OUTCOME.GOAL) return 'goal';
  if (outcome === OUTCOME.SAVE) return 'save';
  if (outcome === OUTCOME.MISS) return 'miss';
  return 'skipped';
}

/**
 * A spoken description of where the reticle is, so the aim control means
 * something without sight of the canvas. Deliberately coarse: a screen reader
 * user does not want three decimal places of metres read out, they want the
 * same information the picture gives — which corner, how high.
 */
function aimLabel(x, y) {
  const outside = Math.abs(x) > CONFIG.GOAL_HALF_W;
  const over = y > CONFIG.GOAL_H;
  const side = x < -1.3 ? 'left' : (x > 1.3 ? 'right' : 'centre');
  const height = y > 1.6 ? 'high' : (y < 0.75 ? 'low' : 'mid-height');

  if (outside && over) return 'Over and wide — outside the frame';
  if (outside) return `Wide ${side} — outside the post`;
  if (over) return 'Above the crossbar';
  if (side === 'centre') return `Centre, ${height}`;
  return `${side.charAt(0).toUpperCase()}${side.slice(1)}, ${height}`;
}

/* --- keypad zones <-> metres ----------------------------------------------
 * input.js publishes the nine zones normalised (x in [-1,1], y in [0,1]) and
 * leaves the mapping to metres to its consumer. Both directions of that
 * mapping live here, adjacent, because they are inverses: if they drift the
 * grid highlights the wrong cell for the shot it just took, which is the kind
 * of wrongness nobody reports and everybody feels.
 *
 * The zones are inset from the frame. A player who asks for "top left" should
 * get a shot that can go in; let the power-dependent spread be the thing that
 * punishes greed, not the zone table.
 */
const ZONE_SPAN_X = CONFIG.GOAL_HALF_W - 0.57;
const ZONE_BASE_Y = CONFIG.AIM_Y_MIN;
const ZONE_SPAN_Y = CONFIG.GOAL_H - 0.30 - CONFIG.AIM_Y_MIN;

/** Keypad index -> aim point in metres. Writes into `out`, never allocates. */
export function zoneToAim(zones, index, out) {
  if (index < 0 || index > 8) return false;
  out.x = zones[index * 2] * ZONE_SPAN_X;
  out.y = ZONE_BASE_Y + zones[index * 2 + 1] * ZONE_SPAN_Y;
  return true;
}

/** Aim point in metres -> nearest keypad index. The exact inverse of above. */
function nearestZone(zones, x, y) {
  const nx = x / ZONE_SPAN_X;
  const ny = (y - ZONE_BASE_Y) / ZONE_SPAN_Y;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < 9; i++) {
    const dx = zones[i * 2] - nx;
    const dy = zones[i * 2 + 1] - ny;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Zone names, in keypad order (1..9 → index 0..8). */
const ZONE_NAMES = [
  'Bottom left', 'Bottom centre', 'Bottom right',
  'Middle left', 'Middle centre', 'Middle right',
  'Top left', 'Top centre', 'Top right',
];

/* --- the HUD -------------------------------------------------------------- */

/**
 * @param {HTMLElement} mount   the game root; the HUD is appended to it
 * @param {object} handlers     { onZone, onPower, onShoot, onNext, onReplay,
 *                                onExit, onJump, zones }
 */
export function createHud(mount, handlers) {
  const h = handlers || {};
  const zones = h.zones || new Float32Array(18);

  /** Every listener goes through on(), so destroy() is one sweep and cannot
   *  miss one. Same discipline as site.js. */
  const cleanups = [];
  function on(node, type, fn, options) {
    node.addEventListener(type, fn, options);
    cleanups.push(() => node.removeEventListener(type, fn, options));
  }

  /* --- scoreboard --------------------------------------------------------- */

  const roundValue = el('span', { class: 'gm-board__value', text: '1' });
  const roundTotal = el('span', { class: 'gm-board__total', text: '5' });
  const scoreValue = el('span', { class: 'gm-board__value', text: '0' });

  const pips = el('ol', { class: 'gm-board__pips' });
  const pipNodes = [];

  const board = el('div', { class: 'gm-board' }, [
    el('p', { class: 'gm-board__stat' }, [
      el('span', { class: 'gm-board__label', text: 'Round' }),
      el('span', { class: 'gm-board__figure' }, [
        roundValue,
        el('span', { class: 'gm-board__sep', 'aria-hidden': 'true', text: '/' }),
        el('span', { class: 'sr-only', text: ' of ' }),
        roundTotal,
      ]),
    ]),
    pips,
    el('p', { class: 'gm-board__stat gm-board__stat--score' }, [
      el('span', { class: 'gm-board__label', text: 'Scored' }),
      el('span', { class: 'gm-board__figure' }, [scoreValue]),
    ]),
  ]);

  /**
   * The exit is a real button in the top bar and is never hidden, disabled or
   * moved by any state below. A visitor who does not want to play a game to
   * read a CV must be one unambiguous click from not playing one, at every
   * moment, including mid-flight and mid-celebration.
   */
  const skipButton = el('button', {
    class: 'gm-skip',
    type: 'button',
    text: 'Skip to the written version',
  });
  on(skipButton, 'click', () => { if (h.onExit) h.onExit(); });

  let playerNumber = '';

  const bar = el('div', { class: 'gm-hud__bar' }, [board, skipButton]);

  /* Big white call-out over the pitch. It greets the player by squad number,
     then carries the result of each shot. aria-hidden because the same words
     already go to the live region through the scene's announce(). */
  const banner = el('p', { class: 'gm-banner', 'aria-hidden': 'true' }, [
    el('span', { class: 'gm-banner__text', text: '' }),
  ]);
  const bannerText = banner.firstChild;

  /* --- commentary --------------------------------------------------------- */

  // Not a live region. main.js owns the page's only live region and the scene
  // routes through opts.announce; a second aria-live here would make every
  // reveal speak twice and the two would race.
  const commentary = el('p', { class: 'gm-commentary', 'data-state': 'idle' });
  const commentaryText = el('span', { class: 'gm-commentary__text', text: 'Pick a corner.' });
  const commentaryBadge = el('span', { class: 'gm-commentary__badge', hidden: true });
  commentary.append(commentaryBadge, commentaryText);

  /* --- aim grid ----------------------------------------------------------- */

  const zoneButtons = [];
  const grid = el('div', { class: 'gm-aim__grid' });
  // Built top row first so the DOM order matches what the eye sees (7 8 9 on
  // top), while the value passed to onZone stays the keypad index.
  for (let row = 2; row >= 0; row--) {
    for (let col = 0; col < 3; col++) {
      const index = row * 3 + col;
      const button = el('button', {
        class: 'gm-aim__zone',
        type: 'button',
        'data-zone': String(index),
        'aria-label': `${ZONE_NAMES[index]} (key ${index + 1})`,
      }, [
        el('span', { class: 'gm-aim__digit', 'aria-hidden': 'true', text: String(index + 1) }),
      ]);
      on(button, 'click', () => { if (h.onZone) h.onZone(index); });
      zoneButtons[index] = button;
      grid.append(button);
    }
  }

  const aimReadout = el('p', { class: 'gm-aim__readout' }, [
    el('span', { class: 'gm-aim__readout-label', text: 'Aim' }),
    el('span', { class: 'gm-aim__readout-value', text: aimLabel(0, 1) }),
  ]);
  const aimValue = aimReadout.lastChild;

  const aim = el('div', {
    class: 'gm-aim',
    role: 'group',
    'aria-label': 'Aim. Arrow keys move the target, number keys 1 to 9 jump to a zone.',
  }, [aimReadout, grid]);

  /* --- power -------------------------------------------------------------- */

  // A native range input, on purpose. It is the one control here that has a
  // continuous value, and the platform's own slider brings keyboard support,
  // touch behaviour, screen-reader semantics and high-contrast rendering that
  // a div with a drag handler would spend a hundred lines failing to match.
  // input.js explicitly declines to swallow arrow keys inside form controls so
  // that this element keeps working as a slider.
  const powerInput = el('input', {
    class: 'gm-power__input',
    id: 'gm-power',
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: '55',
    'aria-describedby': 'gm-power-note',
  });
  const powerOut = el('output', { class: 'gm-power__value', for: 'gm-power', text: '55%' });

  // Guards the two-way binding: the scene writes the slider when the player
  // uses +/-, and the slider writes the scene when dragged. Without this flag
  // each would re-trigger the other.
  let echoingPower = false;
  on(powerInput, 'input', () => {
    if (echoingPower) return;
    const value = Number(powerInput.value);
    if (!Number.isFinite(value)) return;
    if (h.onPower) h.onPower(value / 100);
  });

  const power = el('div', { class: 'gm-power' }, [
    el('div', { class: 'gm-power__head' }, [
      el('label', { class: 'gm-power__label', for: 'gm-power', text: 'Power' }),
      powerOut,
    ]),
    powerInput,
    el('p', {
      class: 'gm-power__note',
      id: 'gm-power-note',
      text: 'More power is harder for the keeper and harder to place.',
    }),
  ]);

  /* --- shoot -------------------------------------------------------------- */

  const shootButton = el('button', {
    class: 'gm-shoot',
    type: 'button',
  }, [
    el('span', { class: 'gm-shoot__word', text: 'Shoot' }),
    el('span', { class: 'gm-shoot__key', 'aria-hidden': 'true', text: 'Space' }),
  ]);
  on(shootButton, 'click', () => { if (h.onShoot) h.onShoot(); });

  const controls = el('div', { class: 'gm-controls' }, [aim, power, shootButton]);
  const deck = el('div', { class: 'gm-hud__deck' }, [commentary, controls]);

  /* --- reveal panel ------------------------------------------------------- */

  const revealRibbon = el('p', { class: 'gm-reveal__ribbon' }, [
    el('span', { class: 'gm-reveal__outcome', text: 'Goal' }),
    el('span', { class: 'gm-reveal__line', text: '' }),
  ]);
  const revealOutcome = revealRibbon.firstChild;
  const revealLine = revealRibbon.lastChild;

  const revealSlot = el('div', { class: 'gm-reveal__card' });

  const nextButton = el('button', { class: 'gm-btn gm-btn--go', type: 'button', text: 'Next penalty' });
  on(nextButton, 'click', () => { if (h.onNext) h.onNext(); });

  const revealExit = el('button', {
    class: 'gm-btn gm-btn--quiet',
    type: 'button',
    text: 'Read the written version',
  });
  on(revealExit, 'click', () => { if (h.onExit) h.onExit(); });

  const revealHeading = el('h2', {
    class: 'sr-only',
    id: 'gm-reveal-title',
    tabindex: '-1',
    text: 'Project revealed',
  });

  const revealPanel = el('section', {
    class: 'gm-panel gm-panel--reveal',
    'aria-labelledby': 'gm-reveal-title',
    hidden: true,
  }, [
    revealHeading,
    revealRibbon,
    revealSlot,
    el('div', { class: 'gm-panel__foot' }, [nextButton, revealExit]),
  ]);

  /* --- summary panel ------------------------------------------------------ */

  const summaryScore = el('p', { class: 'gm-summary__score' });
  const summaryNote = el('p', { class: 'gm-summary__note' });
  const summaryList = el('ol', { class: 'gm-summary__list' });

  const replayButton = el('button', { class: 'gm-btn gm-btn--go', type: 'button', text: 'Play again' });
  on(replayButton, 'click', () => { if (h.onReplay) h.onReplay(); });

  const summaryExit = el('button', {
    class: 'gm-btn gm-btn--quiet',
    type: 'button',
    text: 'Read the written version',
  });
  on(summaryExit, 'click', () => { if (h.onExit) h.onExit(); });

  const summaryHeading = el('h2', {
    class: 'gm-summary__title',
    id: 'gm-summary-title',
    tabindex: '-1',
    text: 'Full time',
  });

  const summaryPanel = el('section', {
    class: 'gm-panel gm-panel--summary',
    'aria-labelledby': 'gm-summary-title',
    hidden: true,
  }, [
    summaryHeading,
    summaryScore,
    summaryNote,
    summaryList,
    el('div', { class: 'gm-panel__foot' }, [replayButton, summaryExit]),
  ]);

  /* --- assembly ----------------------------------------------------------- */

  const hud = el('div', { class: 'gm-hud' }, [bar, banner, deck, revealPanel, summaryPanel]);
  mount.append(hud);

  /**
   * GIVE THE KEYBOARD BACK INSIDE A PANEL.
   *
   * input.js binds its key handlers to the game root and calls preventDefault
   * on every key it consumes — arrows, space, digits. That is correct over the
   * pitch: those keys are the aim and the shot. It is wrong inside an open
   * panel, where the same keys are how a keyboard user reads a project card
   * that is taller than the viewport. Space would fire a penalty instead of
   * paging down, and the arrows would move a reticle nobody can see.
   *
   * A capture-phase listener on each panel stops the event before it ever
   * reaches the root's bubble-phase handler, so inside a panel the browser's
   * own behaviour applies: space and arrows scroll, Tab moves, Enter and space
   * activate the focused button. stopPropagation and not preventDefault, so
   * button activation — which is a default action, not a listener — is
   * untouched.
   */
  function isolateKeys(event) { event.stopPropagation(); }
  for (const panel of [revealPanel, summaryPanel]) {
    on(panel, 'keydown', isolateKeys, true);
    on(panel, 'keyup', isolateKeys, true);
  }

  /**
   * One delegated listener for the whole summary list, installed once.
   * Binding per row would push a cleanup entry per row per replay, and those
   * closures would pile up for the life of the mount.
   */
  on(summaryList, 'click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-index]')
      : null;
    if (!target || !summaryList.contains(target)) return;
    const index = Number(target.dataset.index);
    if (Number.isInteger(index) && h.onJump) h.onJump(index);
  });

  /* --- memoised state ------------------------------------------------------
   * Everything below exists so a setter called 60 times a second writes to the
   * DOM only when the value it would write has actually changed. */

  let lastRound = -1;
  let lastTotal = -1;
  let lastScore = -1;
  let lastAimText = '';
  let lastPower = -1;
  let lastZone = -1;
  let lastPhase = '';
  let lastCommentary = '';
  let lastBadge = '';
  const pipState = [];

  /* --- public surface ------------------------------------------------------ */

  const api = {
    /** Exposed so the scene can restore focus to a sensible place. */
    nodes: { hud, revealPanel, summaryPanel, revealHeading, summaryHeading, shootButton },

    setRounds(total) {
      const n = Math.max(0, total | 0);
      if (n === lastTotal) return;
      lastTotal = n;
      roundTotal.textContent = String(n);

      pips.replaceChildren();
      pipNodes.length = 0;
      pipState.length = 0;
      for (let i = 0; i < n; i++) {
        const label = el('span', { class: 'sr-only', text: `Penalty ${i + 1}: not taken.` });
        const pip = el('li', { class: 'gm-board__pip', 'data-state': 'pending' }, [label]);
        pipNodes.push({ pip, label });
        pipState.push('pending');
        pips.append(pip);
      }
    },

    setRound(index) {
      const n = (index | 0) + 1;
      if (n === lastRound) return;
      lastRound = n;
      roundValue.textContent = String(n);
      for (let i = 0; i < pipNodes.length; i++) {
        pipNodes[i].pip.dataset.current = String(i === index);
      }
    },

    setScore(goals) {
      const n = goals | 0;
      if (n === lastScore) return;
      lastScore = n;
      scoreValue.textContent = String(n);
    },

    setPip(index, outcome, flavor) {
      const entry = pipNodes[index];
      if (!entry) return;
      const key = outcomeKey(outcome);
      if (pipState[index] === key) return;
      pipState[index] = key;
      entry.pip.dataset.state = key;
      entry.label.textContent = `Penalty ${index + 1}: ${outcomeWord(outcome, flavor)}.`;
    },

    resetPips() {
      for (let i = 0; i < pipNodes.length; i++) {
        pipState[i] = 'pending';
        pipNodes[i].pip.dataset.state = 'pending';
        pipNodes[i].label.textContent = `Penalty ${i + 1}: not taken.`;
      }
      lastScore = -1;
      lastRound = -1;
    },

    /**
     * Called from the fixed step. Three guarded comparisons and, in the common
     * case, zero DOM writes.
     */
    setAim(x, y, powerValue) {
      const label = aimLabel(x, y);
      if (label !== lastAimText) {
        lastAimText = label;
        aimValue.textContent = label;
      }

      const pct = Math.round(powerValue * 100);
      if (pct !== lastPower) {
        lastPower = pct;
        powerOut.textContent = `${pct}%`;
        if (powerInput.value !== String(pct)) {
          echoingPower = true;
          powerInput.value = String(pct);
          echoingPower = false;
        }
      }

      const zone = nearestZone(zones, x, y);
      if (zone !== lastZone) {
        if (zoneButtons[lastZone]) delete zoneButtons[lastZone].dataset.near;
        if (zoneButtons[zone]) zoneButtons[zone].dataset.near = 'true';
        lastZone = zone;
      }
    },

    /**
     * Phase drives which controls are usable. The controls are DISABLED rather
     * than removed while a shot is in the air: removing them would collapse the
     * layout under the player's cursor and move the focus ring somewhere
     * arbitrary between rounds.
     */
    setPhase(phase) {
      if (phase === lastPhase) return;
      lastPhase = phase;
      hud.dataset.phase = phase;

      const aiming = phase === 'aim';
      shootButton.disabled = !aiming;
      powerInput.disabled = !aiming;
      for (let i = 0; i < zoneButtons.length; i++) zoneButtons[i].disabled = !aiming;
    },

    /**
     * The big white line over the pitch.
     *
     * `tone` drives colour only. Passing '' clears it, which is how the greeting
     * gets out of the way once the first shot is taken.
     */
    /** Squad number used on the celebrating player's shirt. */
    setPlayerNumber(value) {
      playerNumber = value === null || value === undefined ? '' : String(value);
    },

    setBanner(message, tone) {
      const value = t(message);
      bannerText.textContent = value;
      banner.dataset.tone = t(tone) || 'neutral';
      banner.hidden = !value;
    },

    setCommentary(line, badge) {
      const value = t(line);
      if (value !== lastCommentary) {
        lastCommentary = value;
        commentaryText.textContent = value;
      }
      const badgeValue = t(badge);
      if (badgeValue !== lastBadge) {
        lastBadge = badgeValue;
        commentaryBadge.textContent = badgeValue;
        commentaryBadge.hidden = !badgeValue;
        commentary.dataset.state = badgeValue ? badgeValue.toLowerCase().replace(/[^a-z]+/g, '-') : 'idle';
      }
    },

    /**
     * Build and show the project card.
     *
     * `outcome` styles the frame and decides whether the flip-in plays. It
     * never decides what is in the frame — every branch below renders the same
     * fields, and a skipped round renders them too.
     */
    showReveal(project, index, outcome, flavor, line, nextLabel, reducedMotion) {
      const card = buildProjectCard(project, index);
      const key = outcomeKey(outcome);

      revealPanel.dataset.outcome = key;
      revealOutcome.textContent = outcomeWord(outcome, flavor);
      revealLine.textContent = t(line);
      revealLine.hidden = !t(line);

      // The flip-in is the UI agent's animation and already multiplies its
      // travel by --motion-ok; the class is withheld entirely under reduced
      // motion so there is no entrance at all rather than a fast one.
      if (key === 'goal' && !reducedMotion) card.classList.add('proj-card--revealed');

      // Card left, celebrating player right — the panel used to be a column of
      // text with an empty half beside it.
      const stage = document.createElement('div');
      stage.className = 'gm-reveal__stage';
      stage.append(card);
      const figure = document.createElement('div');
      figure.className = 'gm-reveal__player';
      figure.append(playerFigure(playerNumber));
      const caption = document.createElement('p');
      caption.className = 'gm-reveal__player-caption';
      caption.textContent = 'Good goal';
      figure.append(caption);
      stage.append(figure);
      revealSlot.replaceChildren(stage);
      revealHeading.textContent = `${t(project && project.name) || 'Project'} revealed`;
      nextButton.textContent = nextLabel || 'Next penalty';

      summaryPanel.hidden = true;
      revealPanel.hidden = false;
      return revealHeading;
    },

    /**
     * Saved or missed. The panel is still standing, so this offers another go
     * rather than the project.
     *
     * It reuses the reveal panel's frame — same ribbon, same buttons, same
     * focus target — with an empty content slot, so there is one panel to style
     * and one to tear down rather than two that can disagree.
     */
    showRetry(line, word) {
      const key = 'save';
      revealPanel.dataset.outcome = key;
      revealOutcome.textContent = t(word) || 'Saved';
      revealLine.textContent = t(line);
      revealLine.hidden = !t(line);

      const again = document.createElement('div');
      again.className = 'gm-retry';

      const h = document.createElement('p');
      h.className = 'gm-retry__lead';
      h.textContent = 'That one stays up.';
      again.append(h);

      const sub = document.createElement('p');
      sub.className = 'gm-retry__sub';
      sub.textContent = 'Penalties are unlimited — go again, or read the written version any time.';
      again.append(sub);

      revealSlot.replaceChildren(again);
      revealHeading.textContent = 'Saved. Take it again';
      nextButton.textContent = 'Take it again';

      summaryPanel.hidden = true;
      revealPanel.hidden = false;
      return revealHeading;
    },

    hideReveal() {
      revealPanel.hidden = true;
      revealSlot.replaceChildren();
    },

    /**
     * Full time. Offers both continuations the brief requires, and makes every
     * project reachable again by name so the summary is a table of contents
     * rather than a dead end.
     */
    showSummary(results, goals, total, reducedMotion) {
      const scored = goals | 0;
      summaryScore.replaceChildren(
        el('span', { class: 'gm-summary__figure', text: String(scored) }),
        el('span', { class: 'gm-summary__of', text: ` scored from ${total | 0}` })
      );

      summaryNote.textContent = scored === total
        ? 'Every one of them. All five projects are below — open any of them again.'
        : 'The score changed the celebration, not the content. All five projects were revealed; open any of them again.';

      summaryList.replaceChildren();
      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        const name = t(row.name) || `Project ${i + 1}`;
        const button = el('button', {
          class: 'gm-summary__jump',
          type: 'button',
          'data-index': String(i),
        }, [
          el('span', { class: 'gm-summary__num', 'aria-hidden': 'true', text: pad2(i + 1) }),
          el('span', { class: 'gm-summary__name', text: name }),
          // Plain visible text, announced once. An sr-only/aria-hidden pair
          // here would put the same word in the tree twice for no gain.
          el('span', {
            class: 'gm-summary__mark',
            'data-state': outcomeKey(row.outcome),
            text: outcomeWord(row.outcome, row.flavor),
          }),
        ]);
        // No listener here: the list has one delegated handler, installed at
        // build time and keyed off data-index.
        summaryList.append(el('li', null, [button]));
      }

      summaryPanel.dataset.motion = reducedMotion ? 'still' : 'play';
      revealPanel.hidden = true;
      summaryPanel.hidden = false;
      return summaryHeading;
    },

    hideSummary() {
      summaryPanel.hidden = true;
    },

    destroy() {
      while (cleanups.length) {
        const dispose = cleanups.pop();
        try { dispose(); } catch { /* a failed cleanup must not block the rest */ }
      }
      zoneButtons.length = 0;
      pipNodes.length = 0;
      hud.remove();
    },
  };

  return api;
}

/**
 * The `.proj-card` tree, exactly as css/site.css documents it.
 *
 * Kept byte-for-byte compatible with site.js's version on purpose: the two are
 * rendered by one stylesheet, and a card that diverged here would be a card
 * that looks subtly wrong only in game mode, which is precisely the bug nobody
 * catches before it ships.
 */
function buildProjectCard(project, index) {
  const source = project || {};
  const id = slug(source.id, `project-${index + 1}`);
  const name = t(source.name);
  const points = Array.isArray(source.points) ? source.points.map(t).filter(Boolean) : [];
  const body = list(source.body);
  const tech = list(source.tech);
  const highlight = source.highlight || {};
  const hlText = t(highlight.text);
  const provenance = t(source.provenance);
  const repo = safeHref(source.repo);

  const chips = tech.length
    ? el('ul', { class: 'chip-row' }, tech.map((value) => el('li', null, [
        el('span', { class: 'chip', text: value }),
      ])))
    : null;

  return el('article', {
    class: 'proj-card',
    'data-project': id,
    'aria-labelledby': `gm-proj-${id}-name`,
  }, [
    el('div', { class: 'proj-card__top' }, [
      el('span', { class: 'proj-card__num', 'aria-hidden': 'true', text: pad2(index + 1) }),
      el('h3', { class: 'proj-card__name', id: `gm-proj-${id}-name`, text: name }),
    ]),
    // No blurb, no highlight callout: the card carries only the copy the owner
    // wrote. Same rule as the site card, so both renderers show the same thing.
    body.length
      ? el('div', { class: 'proj-card__body' }, body.map((para) => el('p', { text: para })))
      : null,
    points.length
      ? el('ul', { class: 'proj-card__points' }, points.map((line) => el('li', { text: line })))
      : null,
    chips,
    provenance ? el('p', { class: 'proj-card__prov', text: provenance }) : null,
    repo
      ? el('div', { class: 'proj-card__foot' }, [
          el('a', {
            class: 'proj-card__repo',
            href: repo,
            rel: 'noopener noreferrer',
          }, [
            'Repository',
            el('span', { class: 'sr-only', text: ` for ${name}` }),
          ]),
        ])
      : null,
  ]);
}

export { outcomeWord, outcomeKey };

/**
 * Bootstrap and mode switching. Owned by the lead — agents should not edit this.
 *
 * Two modes over one content source. Normal mode is an ordinary personal site.
 * Shootout mode wraps the same content in a penalty shootout. The toggle is
 * reachable from anywhere and the game never withholds anything, so a visitor
 * who does not want to play is never worse off than one who does.
 */

import { CONTENT } from './content.js';
import { mountSite, startPlayerNumber } from './site.js';

/**
 * The game is loaded on demand, never at startup, for three reasons that all
 * point the same way:
 *
 *   1. Failure isolation. A static import puts the game in the same module
 *      graph as the site, so one broken game file takes the whole résumé down
 *      with it — a blank page for a recruiter because a particle emitter had a
 *      typo. Loaded dynamically, a game that fails to load leaves the written
 *      site untouched.
 *   2. Payload. Most visitors never press Play. They should not download a
 *      physics engine to read three paragraphs.
 *   3. It makes the toggle honest: nothing about the game runs until asked.
 */
let gameModulePromise = null;
function loadGame() {
  gameModulePromise ??= import('./game/index.js');
  return gameModulePromise;
}

const STORAGE_KEY = 'gm-mode';
const THEME_KEY = 'gm-theme';
const MODES = /** @type {const} */ (['site', 'shootout']);

/** Elements index.html must provide. */
const ids = {
  root: 'app-root',
  toggle: 'mode-toggle',
  live: 'a11y-live',
  skip: 'skip-link',
};

let active = null;
let currentMode = null;
let mountToken = 0;

/** Screen-reader announcements. Game reveals route through here. */
function announce(message) {
  const live = document.getElementById(ids.live);
  if (!live) return;
  // Clear first so repeat messages are re-announced.
  live.textContent = '';
  window.setTimeout(() => { live.textContent = String(message); }, 50);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * localStorage throws outright in some privacy configurations rather than
 * returning null, so every access is guarded and the site works with none of it.
 */
function readStoredMode() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode) {
  try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* fine */ }
}

function modeFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  return MODES.includes(hash) ? hash : null;
}

function resolveInitialMode() {
  // Explicit link wins, then whatever the visitor last chose, then the game.
  //
  // The shootout is the front door: it is the reason to remember this page.
  // Two things keep that from costing anything. A returning visitor who
  // switched to reading stays on reading, because their choice outranks the
  // default. And the game reveals every section regardless of whether the shot
  // goes in, with the way out to the written version always on screen — so
  // landing here is an invitation, never a gate.
  //
  // Reduced motion is the exception. Someone who has asked their OS to stop
  // animating things should not be dropped into a ball-physics simulation.
  if (prefersReducedMotion()) return modeFromHash() ?? readStoredMode() ?? 'site';
  return modeFromHash() ?? readStoredMode() ?? 'shootout';
}

function setMode(mode, { announceChange = true } = {}) {
  if (!MODES.includes(mode) || mode === currentMode) return;

  active?.destroy();
  active = null;

  const root = document.getElementById(ids.root);
  if (!root) return;
  root.replaceChildren();

  currentMode = mode;
  document.documentElement.dataset.mode = mode;
  writeStoredMode(mode);

  // Keep the URL honest. Without this a visitor who arrives on #site and then
  // switches to the game still has #site in the address bar, so copying the
  // link — or simply reloading — silently puts them back where they were not.
  // replaceState rather than assigning location.hash: assigning would fire
  // hashchange and re-enter this function, and it would stack a history entry
  // per toggle so Back walks through modes instead of leaving the site.
  if (window.location.hash.replace(/^#/, '') !== mode) {
    try {
      window.history.replaceState(null, '', '#' + mode);
    } catch {
      /* Some embedded contexts refuse replaceState. The mode still changed. */
    }
  }

  const toggle = document.getElementById(ids.toggle);
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(mode === 'shootout'));
    toggle.dataset.mode = mode;
  }

  if (mode === 'shootout') {
    // Token so a fast double-toggle cannot mount a game the user already left.
    const token = ++mountToken;
    root.dataset.loading = 'true';

    loadGame().then(({ mountGame }) => {
      if (token !== mountToken || currentMode !== 'shootout') return;
      delete root.dataset.loading;
      active = mountGame(root, CONTENT, {
        reducedMotion: prefersReducedMotion(),
        onExit: () => setMode('site'),
        onReveal: (id) => announce(`Revealed: ${id}`),
        announce,
      });
      if (announceChange) {
        announce('Shootout mode. Take a penalty to reveal each section, or skip to the written version at any time.');
      }
    }).catch((error) => {
      // The game is the optional half. If it cannot load, say so once and put
      // the reader back on the content rather than leaving them on a blank page.
      console.error('shootout failed to load', error);
      if (token !== mountToken) return;
      delete root.dataset.loading;
      currentMode = null;
      setMode('site', { announceChange: false });
      announce('The shootout could not load, so here is the written version.');
    });
  } else {
    active = mountSite(root, CONTENT);
    if (announceChange) announce('Standard mode.');
  }
}

/**
 * Light / dark.
 *
 * Three states, not two: "light", "dark", and unset. Unset is the default and
 * means follow the OS, which is why no data-theme attribute is written until
 * someone actually picks one — stamping a value on load would override a
 * visitor whose system already said what it wants.
 */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;

  for (const button of document.querySelectorAll('[data-theme-set]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeSet === theme));
  }
}

function readStoredTheme() {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function initTheme() {
  applyTheme(readStoredTheme());

  for (const button of document.querySelectorAll('[data-theme-set]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.themeSet;
      // Pressing the active one again returns to following the system.
      const value = document.documentElement.dataset.theme === next ? null : next;
      applyTheme(value);
      try {
        if (value) window.localStorage.setItem(THEME_KEY, value);
        else window.localStorage.removeItem(THEME_KEY);
      } catch { /* preference simply will not persist */ }
    });
  }
}

function init() {
  const root = document.getElementById(ids.root);
  if (!root) {
    console.error('main.js: missing #' + ids.root);
    return;
  }

  setMode(resolveInitialMode(), { announceChange: false });

  document.getElementById(ids.toggle)?.addEventListener('click', () => {
    setMode(currentMode === 'shootout' ? 'site' : 'shootout');
  });

  window.addEventListener('hashchange', () => {
    const mode = modeFromHash();
    if (mode) setMode(mode);
  });

  // Escape always returns to the readable site. A visitor stuck in a game they
  // did not want should have one obvious way out that needs no instruction.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && currentMode === 'shootout') setMode('site');
  });

  // Header chrome, not view content: the widget lives outside #app-root and
  // survives every mode change, so it starts once here rather than inside a
  // mount. Starting it from mountSite meant it never appeared at all for the
  // visitors who land on the shootout, which is now everyone by default.
  initTheme();
  startPlayerNumber();

  document.documentElement.dataset.ready = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

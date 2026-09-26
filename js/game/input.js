/**
 * Input.
 *
 * THE ONE ARCHITECTURAL DECISION HERE: handlers never do work, they only set
 * flags. Aiming is integrated in the fixed physics step from held-direction
 * flags, and "shoot" is a latch the scene consumes exactly once.
 *
 * That is what makes rapid repeated input a non-problem rather than a bug to
 * patch. If aim moved *inside* the keydown handler, the aim speed would be the
 * OS key-repeat rate — different on every machine — and mashing the key would
 * outrun it. If shooting fired from the handler, holding space or double-
 * tapping would queue several shots into one round. With a latch and held
 * flags, ten keydowns between two frames and one keydown between two frames do
 * the same thing, and no debounce timer is needed anywhere.
 *
 * Every listener registered here is removed in destroy(). Held flags are also
 * cleared on blur and on tab hide, because a key that goes down in this window
 * and up in another one otherwise stays "held" forever.
 */

/** Aim zones for the number keys, laid out like a numeric keypad:
 *  7 8 9 across the top of the goal, 1 2 3 along the ground. Values are
 *  normalised (x in [-1, 1], y in [0, 1]) and mapped to metres by the scene. */
const ZONES = new Float32Array([
  // x, y for digits 1..9
  -0.78, 0.06, 0.00, 0.04, 0.78, 0.06,
  -0.82, 0.42, 0.00, 0.40, 0.82, 0.42,
  -0.86, 0.86, 0.00, 0.80, 0.86, 0.86,
]);

export function createInput(target, canvas, hooks) {
  const state = {
    aimDX: 0,      // -1, 0, 1 — held
    aimDY: 0,
    powerD: 0,
    confirm: false, // latch: consumed by the scene
    zone: -1,       // latch: 0..8
    pointerX: 0,
    pointerY: 0,
    pointerAim: false, // latch: a fresh pointer aim is available
    dragging: false,
  };

  const held = { left: false, right: false, up: false, down: false, inc: false, dec: false };

  function recompute() {
    state.aimDX = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    state.aimDY = (held.up ? 1 : 0) - (held.down ? 1 : 0);
    state.powerD = (held.inc ? 1 : 0) - (held.dec ? 1 : 0);
  }

  function clearHeld() {
    held.left = held.right = held.up = held.down = held.inc = held.dec = false;
    state.dragging = false;
    recompute();
  }

  /** Native controls own their own keys. A range input must keep arrow keys or
   *  it stops being a usable slider for exactly the people who need it most. */
  function isFormControl(el) {
    if (!el || !el.tagName) return false;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable === true;
  }

  function onKeyDown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const formish = isFormControl(e.target);
    const k = e.key;

    switch (k) {
      case 'ArrowLeft': if (formish) return; held.left = true; break;
      case 'ArrowRight': if (formish) return; held.right = true; break;
      case 'ArrowUp': if (formish) return; held.up = true; break;
      case 'ArrowDown': if (formish) return; held.down = true; break;
      case '+': case '=': case ']': case 'PageUp': held.inc = true; break;
      case '-': case '_': case '[': case 'PageDown': held.dec = true; break;
      case ' ': case 'Spacebar': case 'Enter':
        // A button inside the HUD handles its own Enter/Space activation; do
        // not also fire the game action or one press does two things.
        if (formish || (e.target && typeof e.target.closest === 'function' && e.target.closest('button,a'))) return;
        if (!e.repeat) state.confirm = true;
        break;
      case 's': case 'S':
        if (formish) return;
        if (hooks && hooks.onSkip) hooks.onSkip();
        e.preventDefault();
        return;
      default: {
        if (formish) return;
        if (k >= '1' && k <= '9') {
          state.zone = k.charCodeAt(0) - 49;
          break;
        }
        return; // not ours: leave it entirely alone
      }
    }
    recompute();
    // Only prevent default for keys we actually consumed, so Tab, Escape and
    // browser shortcuts keep working.
    e.preventDefault();
  }

  function onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft': held.left = false; break;
      case 'ArrowRight': held.right = false; break;
      case 'ArrowUp': held.up = false; break;
      case 'ArrowDown': held.down = false; break;
      case '+': case '=': case ']': case 'PageUp': held.inc = false; break;
      case '-': case '_': case '[': case 'PageDown': held.dec = false; break;
      default: return;
    }
    recompute();
  }

  function onPointerMove(e) {
    // Hover aims with a mouse; a touch only aims while the finger is down.
    if (e.pointerType !== 'mouse' && !state.dragging) return;
    state.pointerX = e.clientX;
    state.pointerY = e.clientY;
    state.pointerAim = true;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    state.dragging = true;
    state.pointerX = e.clientX;
    state.pointerY = e.clientY;
    state.pointerAim = true;
    if (canvas && canvas.setPointerCapture && e.pointerId !== undefined) {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!state.dragging) return;
    state.dragging = false;
    state.pointerX = e.clientX;
    state.pointerY = e.clientY;
    state.pointerAim = true;
    state.confirm = true;
    if (canvas && canvas.releasePointerCapture && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  }

  function onPointerCancel() { state.dragging = false; }
  function onBlur() { clearHeld(); }
  function onVisibility() { if (document.visibilityState !== 'visible') clearHeld(); }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  if (canvas) {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerCancel);
  }

  return {
    state,
    ZONES,
    /** Read-and-clear. The scene calls these once per step, so a latch set five
     *  times between frames still fires once. */
    takeConfirm() { const v = state.confirm; state.confirm = false; return v; },
    takeZone() { const v = state.zone; state.zone = -1; return v; },
    takePointerAim() { const v = state.pointerAim; state.pointerAim = false; return v; },
    /** Used by the HUD buttons so a click does exactly what a key does. */
    pressConfirm() { state.confirm = true; },
    pressZone(i) { state.zone = i | 0; },
    nudge(dx, dy) { state.aimNudgeX = dx; state.aimNudgeY = dy; },
    clearHeld,
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (canvas) {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('pointerleave', onPointerCancel);
      }
      clearHeld();
    },
  };
}

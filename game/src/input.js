// Keyboard state for the game: which keys are held right now, and which were newly
// pressed since the last frame. One-shot presses (like F to enter a car) are read with
// wasPressed and cleared by endFrame, so a press is seen exactly once and a press that
// lands between two frames is never lost.

const held = new Set();
const pressed = new Set();

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyF', 'Enter',
]);

window.addEventListener('keydown', (event) => {
  if (!GAME_KEYS.has(event.code)) return;
  if (!event.repeat) pressed.add(event.code);
  held.add(event.code);
  event.preventDefault();
});

window.addEventListener('keyup', (event) => {
  held.delete(event.code);
});

// A key released while the tab is hidden never sends keyup: let go of everything on blur.
window.addEventListener('blur', () => {
  held.clear();
  pressed.clear();
});

export function isDown(code) {
  return held.has(code);
}

/** True only on the first frame after the key went down. */
export function wasPressed(code) {
  return pressed.has(code);
}

/** Call once at the end of every frame. */
export function endFrame() {
  pressed.clear();
}

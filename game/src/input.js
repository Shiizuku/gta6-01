// Keyboard state: which keys are held now, and which were newly pressed since the
// last frame. One-shot presses are read with wasPressed and cleared by endFrame.

const held = new Set();
const pressed = new Set();

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyF', 'KeyJ', 'KeyE', 'KeyT', 'Enter',
  'KeyM', 'KeyP', 'Escape', 'Digit1', 'Digit2', 'KeyQ',
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

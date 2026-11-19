// The saved run: one JSON record in localStorage under a versioned key — money,
// health, story progress, the world seed, and where the player (and his car, if he
// was driving one) stood. Loading is defensive on purpose: a corrupted or stale
// record is simply "no save", never a crash, and the game always boots clean.

import { SAVE_KEY } from './config.js';

const VERSION = 1;

/** Read and validate the saved run, or return null when there is nothing usable. */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return null;
    if (!Number.isFinite(data.money) || !Number.isFinite(data.health)) return null;
    if (!Number.isInteger(data.missionsCompleted)) return null;
    if (!Number.isInteger(data.seed)) return null;
    return data;
  } catch (err) {
    return null; // Corrupted JSON or storage denied: play fresh.
  }
}

/** Persist the run. Failures (private mode, quota) are swallowed: saving is a bonus. */
export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ version: VERSION, ...data }));
  } catch (err) { /* the run just will not survive a reload */ }
}

/** Forget the saved run (New Game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (err) { /* nothing to forget, then */ }
}

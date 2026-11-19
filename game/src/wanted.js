// Wanted: how much the Port Azura police care about the player right now, on a scale
// of zero to five stars. Crimes reported through reportCrime add a star, each with its
// own cooldown so the same scrape cannot be farmed for heat; the level then fades one
// star at a time while no police unit can see the player. The rules stay forgiving on
// purpose: nothing here is permanent, and lying low always works eventually.

import { WANTED } from './config.js';

/** The crime catalogue: stars added and the seconds before it can count again. */
const CRIMES = {
  /** Taking a car while a pedestrian or a police unit is watching. */
  steal: { stars: 1, cooldown: 3 },
  /** Running a pedestrian down with a car. */
  hitPed: { stars: 1, cooldown: 6 },
  /** Ramming a police car. */
  hitPolice: { stars: 1, cooldown: 2.5 },
  /** Smashing into traffic at speed, over and over. */
  hitTraffic: { stars: 1, cooldown: 20 },
  /** Punching someone while a witness is near. */
  punch: { stars: 1, cooldown: 8 },
};

export function createWanted() {
  return {
    level: 0,
    /** Seconds since a police unit last had eyes on the player. */
    unseenTime: 0,
    /** Per-crime earliest time (game clock) at which it can add a star again. */
    cooldownUntil: {},
  };
}

/**
 * Report a crime of the given kind at time `now` (the game clock). Adds its star
 * unless that crime is still cooling down. Returns true when a star was added.
 */
export function reportCrime(wanted, kind, now) {
  const crime = CRIMES[kind];
  if (!crime) return false;
  if (now < (wanted.cooldownUntil[kind] || 0)) return false;
  wanted.cooldownUntil[kind] = now + crime.cooldown;
  wanted.level = Math.min(WANTED.maxStars, wanted.level + crime.stars);
  return true;
}

/** Force the level (respawns, the debug hook). Any partial star progress resets. */
export function setWanted(wanted, level) {
  wanted.level = Math.max(0, Math.min(WANTED.maxStars, Math.round(level)));
  wanted.unseenTime = 0;
}

/**
 * Advance the heat by dt. While a police unit sees the player the decay clock stays
 * pinned at zero; once the player has been unseen for WANTED.decaySeconds, one star
 * fades and the clock starts over for the next one.
 */
export function updateWanted(wanted, dt, seenByPolice) {
  if (seenByPolice || wanted.level <= 0) {
    wanted.unseenTime = 0;
    return;
  }
  wanted.unseenTime += dt;
  if (wanted.unseenTime >= WANTED.decaySeconds) {
    wanted.level -= 1;
    wanted.unseenTime = 0;
  }
}

/**
 * True when the straight line between two {x, z} points stays clear of every building
 * AABB — the slab test, run per box. Used for police line-of-sight: a building between
 * a unit and the player means the player is not seen, however close the unit is.
 */
export function hasLineOfSight(a, b, colliders) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    let tmin = 0;
    let tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (a.x < box.minX || a.x > box.maxX) continue;
    } else {
      let t1 = (box.minX - a.x) / dx;
      let t2 = (box.maxX - a.x) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (a.z < box.minZ || a.z > box.maxZ) continue;
    } else {
      let t1 = (box.minZ - a.z) / dz;
      let t2 = (box.maxZ - a.z) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return false; // The segment crosses this building: no line of sight.
  }
  return true;
}

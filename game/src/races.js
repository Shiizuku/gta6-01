// Street races: three checkpoint races a driver joins by steering to the cyan
// start ring and pressing E. Each race is a list of road-grid points the car must
// pass in order; the clock runs from GO to the last checkpoint. Police stay active
// during a race — that is the point. The module never touches the wallet: it
// reports wins through its events queue (win, with the payout already multiplied
// by the district-standing perk) and lets main.js pay out and save.

import { raceRewardMult } from './standing.js';

const CYAN = 0x35e0ff;
const START_RADIUS = 5;
const CP_RADIUS = 7;

export const RACES = [
  {
    id: 'harbour-sprint',
    name: 'Harbour Sprint',
    difficulty: 'Easy',
    reward: 150,
    start: { x: -126, z: 166 },
    checkpoints: [
      { x: -72, z: 166 }, { x: -18, z: 166 }, { x: 36, z: 166 },
      { x: 90, z: 166 }, { x: 138, z: 166 },
    ],
  },
  {
    id: 'downtown-loop',
    name: 'Downtown Loop',
    difficulty: 'Medium',
    reward: 300,
    start: { x: 0, z: -144 },
    checkpoints: [
      { x: 0, z: -36 }, { x: 0, z: 72 }, { x: -72, z: 72 },
      { x: -72, z: 0 }, { x: -72, z: -144 },
    ],
  },
  {
    id: 'marina-dash',
    name: 'Marina Dash',
    difficulty: 'Hard',
    reward: 500,
    start: { x: 144, z: -144 },
    checkpoints: [
      { x: 144, z: 36 }, { x: 36, z: 36 }, { x: 36, z: 144 },
      { x: -72, z: 144 }, { x: -144, z: 144 }, { x: -144, z: 36 },
    ],
  },
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A glowing ring + column marking a race start, and a floating chevron above it. */
function makeStartMarker() {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(START_RADIUS, START_RADIUS, 6, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  column.position.y = 3;
  group.add(column);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(START_RADIUS - 0.4, START_RADIUS, 28),
    new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);
  const chevron = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 1.8, 4),
    new THREE.MeshBasicMaterial({ color: CYAN }),
  );
  chevron.rotation.x = Math.PI;
  chevron.position.y = 7.5;
  group.add(chevron);
  return group;
}

/** The next checkpoint: a pulsing cyan column the driver chases down. */
function makeCheckpointBeam() {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(CP_RADIUS, CP_RADIUS, 9, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  column.position.y = 4.5;
  group.add(column);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CP_RADIUS - 0.5, CP_RADIUS, 28),
    new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);
  group.visible = false;
  return group;
}

export function createRaces(scene, standing) {
  const startMarkers = RACES.map((race) => {
    const marker = makeStartMarker();
    marker.position.set(race.start.x, 0, race.start.z);
    scene.add(marker);
    return marker;
  });
  const cpBeam = makeCheckpointBeam();
  scene.add(cpBeam);

  const best = {}; // race id -> best seconds (lower wins)
  const wins = {}; // race id -> wins
  const events = [];
  let active = null; // { race, index, time, countdown }
  let animT = 0;

  /** The race whose start ring the car is inside, or null. */
  function nearStart(pos) {
    for (const race of RACES) {
      if (dist(pos, race.start) < START_RADIUS + 2) return race;
    }
    return null;
  }

  /** Join a race from its start ring (driver must be in a car). Returns true. */
  function tryStart(pos, inCar) {
    if (active || !inCar) return false;
    const race = nearStart(pos);
    if (!race) return false;
    active = { race, index: 0, time: 0, countdown: 3, goT: 0 };
    cpBeam.visible = false;
    events.push({ type: 'start', name: race.name });
    return true;
  }

  function finishRace() {
    const { race, time } = active;
    const prev = best[race.id];
    const isBest = prev == null || time < prev;
    if (isBest) best[race.id] = Math.round(time * 100) / 100;
    wins[race.id] = (wins[race.id] || 0) + 1;
    const payout = Math.round(race.reward * raceRewardMult(standing, race.start));
    events.push({
      type: 'win', name: race.name, payout, time, isBest,
      district: race.start, reward: race.reward,
    });
    active = null;
    cpBeam.visible = false;
  }

  function cancelRace() {
    if (!active) return;
    events.push({ type: 'cancel', name: active.race.name });
    active = null;
    cpBeam.visible = false;
  }

  /**
   * Advance the race by dt. ctx is { pos, inCar }: where the driven car is and
   * whether the player is still driving it. Stepping out of the car abandons
   * the race; the countdown freezes the car (main.js reads countdownActive).
   */
  function update(dt, ctx) {
    animT += dt;
    for (const marker of startMarkers) {
      marker.children[0].material.opacity = 0.2 + Math.sin(animT * 2.2) * 0.07;
    }
    if (!active) return;
    if (!ctx.inCar) {
      cancelRace();
      return;
    }
    if (active.countdown > 0) {
      active.countdown -= dt;
      if (active.countdown <= 0) active.goT = 0.6; // GO! flashes while the clock runs
      return;
    }
    if (active.goT > 0) active.goT -= dt;
    active.time += dt;
    const next = active.race.checkpoints[active.index];
    cpBeam.position.set(next.x, 0, next.z);
    cpBeam.visible = true;
    cpBeam.children[0].material.opacity = 0.24 + Math.sin(animT * 4) * 0.1;
    if (dist(ctx.pos, next) < CP_RADIUS) {
      active.index += 1;
      if (active.index >= active.race.checkpoints.length) finishRace();
      else events.push({ type: 'checkpoint', name: active.race.name, index: active.index });
    }
  }

  /** One line for the HUD: countdown, the running clock, or nothing. */
  function hudText() {
    if (!active) return '';
    if (active.countdown > 0) {
      const n = Math.ceil(active.countdown);
      return n >= 3 ? '3' : n >= 2 ? '2' : '1';
    }
    if (active.goT > 0) return 'GO!';
    const t = active.time;
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, '0');
    return `${active.race.name}  ${m}:${s}`;
  }

  /** Minimap blips: cyan start rings, plus the next checkpoint while racing. */
  function mapBlips() {
    const blips = RACES.map((race) => ({ x: race.start.x, z: race.start.z, kind: 'race' }));
    if (active && active.countdown <= 0) {
      const next = active.race.checkpoints[active.index];
      blips.push({ x: next.x, z: next.z, kind: 'checkpoint' });
    }
    return blips;
  }

  function serialize() {
    return { best: { ...best }, wins: { ...wins } };
  }

  /** Restore best times and win counts from a save; unknown fields are ignored. */
  function setResults(data) {
    if (!data || typeof data !== 'object') return;
    for (const race of RACES) {
      if (Number.isFinite(data.best?.[race.id])) best[race.id] = data.best[race.id];
      if (Number.isInteger(data.wins?.[race.id])) wins[race.id] = data.wins[race.id];
    }
  }

  return {
    update,
    events,
    tryStart,
    nearStart,
    hudText,
    mapBlips,
    serialize,
    setResults,
    get activeName() { return active ? active.race.name : null; },
    get countdownActive() { return !!active && active.countdown > 0; },
    get active() { return active; },
    get best() { return { ...best }; },
    get wins() { return { ...wins }; },
    get defs() { return RACES; },
  };
}

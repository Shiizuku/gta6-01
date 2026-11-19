// Taxi fares: a repeatable side job. A passenger waits at a roadside spot under
// an amber beam; drive up and press T to take the fare, then drop them at the
// marked destination before the clock runs out. The fare grows with distance, and
// the tip follows district standing (Respected +25%, Legend +50%, the same
// multiplier street races use). The passenger steps out of view when they get in
// and reappears at the kerb when they get out. The module never touches the
// wallet: it reports fares through its events queue and lets main.js pay out.

import { raceRewardMult } from './standing.js';

const AMBER = 0xf2c94c;
const ACCEPT_RADIUS = 5;
const DROP_RADIUS = 8;

const SPOTS = [
  { x: -72, z: -72 }, { x: 36, z: -36 }, { x: -36, z: 36 }, { x: 72, z: 72 },
  { x: 0, z: 144 }, { x: -144, z: 0 }, { x: 144, z: -72 }, { x: 0, z: -72 },
  { x: -108, z: 108 }, { x: 108, z: 108 },
];
const DESTS = [
  { x: -144, z: -144 }, { x: 144, z: 144 }, { x: 0, z: 0 }, { x: -36, z: -108 },
  { x: 108, z: -36 }, { x: -108, z: 36 }, { x: 72, z: -108 }, { x: 144, z: 36 },
  { x: -72, z: 144 }, { x: 36, z: 72 },
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A waiting passenger: amber shirt, dark trousers, one arm raised to flag a cab. */
function makePassenger() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: AMBER });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3242 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.78, 0.2), pants);
  legs.position.y = 0.39;
  group.add(legs);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.7, 10), shirt);
  body.position.y = 1.12;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.y = 1.64;
  group.add(head);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), shirt);
  arm.position.set(0.3, 1.45, 0);
  arm.rotation.z = -0.9;
  group.add(arm);
  return group;
}

/** The amber beam marking a waiting passenger or a drop-off point. */
function makeBeam() {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 6, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: AMBER, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  column.position.y = 3;
  group.add(column);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.0, 2.4, 24),
    new THREE.MeshBasicMaterial({
      color: AMBER, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);
  return group;
}

export function createTaxi(scene, standing) {
  const passenger = makePassenger();
  scene.add(passenger);
  const beam = makeBeam();
  scene.add(beam);

  const events = [];
  let fares = 0;
  let earned = 0;
  let spotIdx = -1;
  let active = null; // { dest, timeLeft, payout }
  let waitT = 0; // seconds until the next passenger appears
  let animT = 0;

  function nextPassenger() {
    let next = Math.floor(Math.random() * SPOTS.length);
    if (next === spotIdx) next = (next + 1) % SPOTS.length;
    spotIdx = next;
    const spot = SPOTS[spotIdx];
    passenger.position.set(spot.x, 0, spot.z);
    passenger.visible = true;
    beam.position.set(spot.x, 0, spot.z);
    beam.visible = true;
  }
  nextPassenger();

  /** Take the waiting fare (driver must be in a car, close to the passenger). */
  function tryAccept(pos, inCar) {
    if (active || !inCar || !passenger.visible) return false;
    if (dist(pos, SPOTS[spotIdx]) > ACCEPT_RADIUS) return false;
    let destIdx = Math.floor(Math.random() * DESTS.length);
    if (DESTS[destIdx].x === SPOTS[spotIdx].x && DESTS[destIdx].z === SPOTS[spotIdx].z) {
      destIdx = (destIdx + 1) % DESTS.length;
    }
    const dest = DESTS[destIdx];
    const d = dist(SPOTS[spotIdx], dest);
    const base = 30 + Math.round(d / 10);
    const payout = Math.round(base * raceRewardMult(standing, dest));
    active = { dest, timeLeft: 40 + d * 0.3, payout };
    passenger.visible = false; // They climb in.
    beam.position.set(dest.x, 0, dest.z);
    beam.visible = true;
    events.push({ type: 'pickup' });
    return true;
  }

  function update(dt, ctx) {
    animT += dt;
    beam.children[0].material.opacity = 0.22 + Math.sin(animT * 2.6) * 0.08;
    if (!active) {
      if (!passenger.visible) {
        waitT -= dt;
        if (waitT <= 0) nextPassenger();
      }
      return;
    }
    if (!ctx.inCar) { // Stepping out mid-fare loses the passenger.
      events.push({ type: 'cancel' });
      active = null;
      passenger.visible = false;
      beam.visible = false;
      waitT = 3;
      return;
    }
    active.timeLeft -= dt;
    if (active.timeLeft <= 0) {
      events.push({ type: 'timeout' });
      active = null;
      passenger.visible = false;
      beam.visible = false;
      waitT = 3;
      return;
    }
    if (dist(ctx.pos, active.dest) < DROP_RADIUS) {
      const { payout } = active;
      const dest = active.dest;
      active = null;
      fares += 1;
      earned += payout;
      passenger.position.set(dest.x, 0, dest.z);
      passenger.visible = true; // They climb out at the kerb.
      beam.visible = false;
      waitT = 3;
      events.push({ type: 'fare', payout });
    }
  }

  /** One line for the HUD: the running fare clock, or nothing. */
  function hudText() {
    if (!active) return '';
    return `Taxi fare — drop off in ${Math.max(0, Math.ceil(active.timeLeft))}s ($${active.payout})`;
  }

  /** Minimap blips: the waiting passenger, or the drop-off while a fare runs. */
  function mapBlips() {
    if (active) return [{ x: active.dest.x, z: active.dest.z, kind: 'taxiDest' }];
    if (passenger.visible) {
      const spot = SPOTS[spotIdx];
      return [{ x: spot.x, z: spot.z, kind: 'taxi' }];
    }
    return [];
  }

  function serialize() {
    return { fares, earned };
  }

  function setResults(data) {
    if (!data || typeof data !== 'object') return;
    if (Number.isInteger(data.fares)) fares = Math.max(0, data.fares);
    if (Number.isFinite(data.earned)) earned = Math.max(0, Math.round(data.earned));
  }

  return {
    update,
    events,
    tryAccept,
    hudText,
    mapBlips,
    serialize,
    setResults,
    nearWaiting(pos) {
      return passenger.visible && !active && dist(pos, SPOTS[spotIdx]) < ACCEPT_RADIUS + 2;
    },
    get active() { return !!active; },
    get dest() { return active ? { ...active.dest } : null; },
    get waitingSpot() {
      return passenger.visible && !active ? { ...SPOTS[spotIdx] } : null;
    },
    get fares() { return fares; },
    get earned() { return earned; },
  };
}

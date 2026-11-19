// Harbour stashes: ten glowing green caches around Port Azura — alley corners,
// the quay, the far ends of the grid. Walk or drive over one: +$25 and +1 standing
// in that district. All ten pay a $250 bonus. The module never touches the wallet:
// it reports pickups through its events queue and lets main.js pay out and save.

import { districtAt } from './standing.js';

const GREEN = 0x7dff8a;
const PICKUP_RADIUS = 3.5;
export const STASH_TOTAL = 10;

export const STASH_SPOTS = [
  { x: -108, z: -144 }, { x: -72, z: 108 }, { x: 0, z: -36 }, { x: 36, z: 144 },
  { x: 108, z: -108 }, { x: 144, z: 72 }, { x: -108, z: 180 }, { x: -36, z: 180 },
  { x: 72, z: 180 }, { x: 144, z: 180 },
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A stash: a small spinning green gem over a glowing ring on the ground. */
function makeStash() {
  const group = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color: GREEN }),
  );
  gem.position.y = 1.1;
  group.add(gem);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 1.1, 20),
    new THREE.MeshBasicMaterial({
      color: GREEN, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);
  return group;
}

export function createStashes(scene) {
  const items = STASH_SPOTS.map((spot) => {
    const group = makeStash();
    group.position.set(spot.x, 0, spot.z);
    scene.add(group);
    return { ...spot, found: false, group };
  });
  const events = [];
  let animT = 0;

  function update(dt, ctx) {
    animT += dt;
    for (const item of items) {
      if (item.found) continue;
      item.group.children[0].rotation.y = animT * 2.2;
      item.group.children[0].position.y = 1.1 + Math.sin(animT * 2.2) * 0.18;
      if (dist(ctx.pos, item) < PICKUP_RADIUS) {
        item.found = true;
        item.group.visible = false;
        events.push({
          type: 'stash', payout: 25, index: items.indexOf(item),
          district: districtAt(item.x, item.z).id,
        });
      }
    }
  }

  /** Minimap blips: green dots for the stashes still out there. */
  function mapBlips() {
    return items.filter((item) => !item.found).map((item) => ({ x: item.x, z: item.z, kind: 'stash' }));
  }

  function serialize() {
    return { found: items.map((item) => item.found) };
  }

  /** Restore found flags from a save; missing or short lists keep the rest hidden. */
  function setFound(data) {
    if (!data || !Array.isArray(data.found)) return;
    items.forEach((item, i) => {
      if (data.found[i] === true) {
        item.found = true;
        item.group.visible = false;
      }
    });
  }

  return {
    update,
    events,
    mapBlips,
    serialize,
    setFound,
    get count() { return items.filter((item) => item.found).length; },
    get total() { return STASH_TOTAL; },
    get found() { return items.map((item) => item.found); },
    get spots() { return STASH_SPOTS.map((s) => ({ ...s })); },
  };
}

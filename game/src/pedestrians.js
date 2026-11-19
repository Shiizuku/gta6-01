// Pedestrians: the people of Port Azura. Each one strolls the sidewalk ring around a
// city block, turns its corners, and now and then crosses the road at a corner to
// continue around the neighbouring block. They are not brave: a moving car that gets
// close makes them dodge aside and hurry, the player bumping into one makes them
// sidestep, and a punch sends them fleeing. A fast car knocks one flat — but only
// for a few seconds; nobody gets permanently hurt in Port Azura.
//
// A pedestrian's route lives in { bi, bj, corner }: it is walking the perimeter of
// block (bi, bj) toward that block's corner number `corner`, where the corners are
// numbered by their signs (see SIGNS) and visited in order.

import { CITY, PED } from './config.js';
import { moveWithCollision } from './world.js';
import { turnToward } from './player.js';

const SHIRTS = [0xc2563a, 0x3a7ac2, 0x53a05a, 0xd9a441, 0x8a5fc0, 0xd9d9d9, 0x3fa3a0, 0x74563f];
const SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** How far from a block's centre its sidewalk ring runs. */
const RING = CITY.blockSize / 2 + 1.6;

// Geometries are shared by every pedestrian; shirt materials are cached per colour.
const legGeometry = new THREE.CylinderGeometry(0.085, 0.095, 0.78, 8);
legGeometry.translate(0, -0.39, 0);
const torsoGeometry = new THREE.CylinderGeometry(0.185, 0.235, 0.68, 10);
const armGeometry = new THREE.CylinderGeometry(0.055, 0.065, 0.62, 8);
armGeometry.translate(0, -0.31, 0);
const headGeometry = new THREE.SphereGeometry(0.155, 12, 10);

const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
const pantsMaterial = new THREE.MeshLambertMaterial({ color: 0x2c3242 });
const shirtMaterials = new Map();
function shirtMaterial(colour) {
  if (!shirtMaterials.has(colour)) {
    shirtMaterials.set(colour, new THREE.MeshLambertMaterial({ color: colour }));
  }
  return shirtMaterials.get(colour);
}

function limb(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A low-poly person: swinging legs and arms, a torso in a coloured shirt, a head. */
function buildPerson(shirt) {
  const group = new THREE.Group();
  const material = shirtMaterial(shirt);
  const legL = limb(legGeometry, pantsMaterial, -0.12, 0.8, 0);
  const legR = limb(legGeometry, pantsMaterial, 0.12, 0.8, 0);
  const armL = limb(armGeometry, material, -0.3, 1.42, 0);
  const armR = limb(armGeometry, material, 0.3, 1.42, 0);
  group.add(legL, legR, limb(torsoGeometry, material, 0, 1.12, 0), armL, armR, limb(headGeometry, skinMaterial, 0, 1.64, 0));
  return { group, parts: { legL, legR, armL, armR } };
}

function blockCentre(bi, bj) {
  return {
    x: (bi - CITY.blocks / 2 + 0.5) * CITY.pitch,
    z: (bj - CITY.blocks / 2 + 0.5) * CITY.pitch,
  };
}

function cornerPoint(bi, bj, corner) {
  const centre = blockCentre(bi, bj);
  const [sx, sz] = SIGNS[corner];
  return { x: centre.x + sx * RING, z: centre.z + sz * RING };
}

function cornerIndex(sx, sz) {
  return SIGNS.findIndex(([x, z]) => x === sx && z === sz);
}

/** Scatter the pedestrians over the city's sidewalks, each mid-stroll on some block. */
export function spawnPedestrians(scene, rng) {
  const peds = [];
  for (let n = 0; n < PED.count; n += 1) {
    const bi = Math.floor(rng() * CITY.blocks);
    const bj = Math.floor(rng() * CITY.blocks);
    const corner = Math.floor(rng() * 4);
    const from = cornerPoint(bi, bj, corner);
    const to = cornerPoint(bi, bj, (corner + 1) % 4);
    const f = rng();
    const { group, parts } = buildPerson(SHIRTS[Math.floor(rng() * SHIRTS.length)]);
    group.position.set(from.x + (to.x - from.x) * f, 0, from.z + (to.z - from.z) * f);
    group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    scene.add(group);
    peds.push({
      group,
      parts,
      heading: group.rotation.y,
      walkPhase: rng() * 6,
      speed: PED.walkMin + rng() * (PED.walkMax - PED.walkMin),
      bi,
      bj,
      corner: (corner + 1) % 4,
      target: to,
      dodgeX: 0,
      dodgeZ: 0,
      dodgeT: 0,
      hurryT: 0,
      downT: 0,
      fleeT: 0,
      fleeX: 0,
      fleeZ: 0,
      rng,
    });
  }
  return peds;
}

/**
 * A corner has been reached: usually the stroll continues around the same block, but
 * sometimes the pedestrian crosses the road at the corner and carries on around the
 * block on the other side.
 */
function decideNext(ped) {
  const [sx, sz] = SIGNS[ped.corner];
  if (ped.rng() < PED.crossChance) {
    const axes = ped.rng() < 0.5 ? ['x', 'z'] : ['z', 'x'];
    for (const axis of axes) {
      const sign = axis === 'x' ? sx : sz;
      const nbi = axis === 'x' ? ped.bi + sign : ped.bi;
      const nbj = axis === 'z' ? ped.bj + sign : ped.bj;
      if (nbi < 0 || nbj < 0 || nbi >= CITY.blocks || nbj >= CITY.blocks) continue;
      ped.bi = nbi;
      ped.bj = nbj;
      ped.corner = cornerIndex(axis === 'x' ? -sign : sx, axis === 'z' ? -sign : sz);
      ped.target = cornerPoint(nbi, nbj, ped.corner);
      return;
    }
  }
  ped.corner = (ped.corner + 1) % 4;
  ped.target = cornerPoint(ped.bi, ped.bj, ped.corner);
}

/**
 * The player swings a fist from `pos` facing `heading`: the nearest pedestrian inside
 * a short arc ahead of him is startled into fleeing directly away from the blow.
 * Returns the pedestrian who was hit, or null for a swing at thin air.
 */
export function startlePedestrian(peds, pos, heading) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  let best = null;
  let bestDist = 1.8;
  for (const ped of peds) {
    if (ped.downT > 0) continue;
    const dx = ped.group.position.x - pos.x;
    const dz = ped.group.position.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestDist) continue;
    if (d > 0.4 && (dx * fx + dz * fz) / d < 0.35) continue; // outside the swing arc
    best = ped;
    bestDist = d;
  }
  if (best) {
    best.fleeT = 2.2;
    best.fleeX = pos.x;
    best.fleeZ = pos.z;
  }
  return best;
}

/** Swing the limbs in time with the walk cycle and bob — shared by stroll and flee. */
function animateWalk(ped, dt, speed) {
  ped.walkPhase += dt * speed * 2.3;
  const swing = Math.sin(ped.walkPhase) * 0.5;
  ped.parts.legL.rotation.x = swing;
  ped.parts.legR.rotation.x = -swing;
  ped.parts.armL.rotation.x = -swing * 0.75;
  ped.parts.armR.rotation.x = swing * 0.75;
  ped.group.position.y = Math.abs(Math.sin(ped.walkPhase)) * 0.05;
  ped.group.rotation.y = ped.heading;
}

function stepPedestrian(ped, dt, ctx) {
  const pos = ped.group.position;

  // Knocked flat by a fast car: lie there a few seconds, then get up and stroll on.
  // Nobody dies in Port Azura; they just need a moment.
  if (ped.downT > 0) {
    ped.downT -= dt;
    if (ped.downT <= 0) {
      ped.group.rotation.x = 0;
      pos.y = 0;
    }
    return;
  }
  for (const car of ctx.cars) {
    if (Math.abs(car.speed) < 5) continue;
    const p = car.group.position;
    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    if (dx * dx + dz * dz < 2.9) {
      ped.downT = 3 + ped.rng() * 1.5;
      ped.group.rotation.x = -Math.PI / 2;
      pos.y = 0.3;
      if (ctx.events) ctx.events.push({ type: 'pedHit', byPlayer: car === ctx.playerCar });
      return;
    }
  }

  // Fleeing a punch: straight away from the threat, at a run, until the fright fades.
  if (ped.fleeT > 0) {
    ped.fleeT -= dt;
    const dx = pos.x - ped.fleeX;
    const dz = pos.z - ped.fleeZ;
    const d = Math.hypot(dx, dz) || 1;
    const speed = ped.speed * 2.3;
    ped.heading = turnToward(ped.heading, Math.atan2(dx / d, dz / d), dt * 10);
    moveWithCollision(pos, PED.radius, (dx / d) * speed * dt, (dz / d) * speed * dt, ctx.world.colliders, ctx.world.bounds);
    animateWalk(ped, dt, speed);
    return;
  }

  // Reactions: dodge away from any moving car that gets close (and hurry for a
  // moment), and sidestep when the player on foot walks straight into them.
  let dodgeX = 0;
  let dodgeZ = 0;
  for (const car of ctx.cars) {
    if (Math.abs(car.speed) < 1.2) continue;
    const p = car.group.position;
    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 12.5 && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      dodgeX += (dx / d) * 3.4;
      dodgeZ += (dz / d) * 3.4;
      ped.hurryT = Math.max(ped.hurryT, 0.9);
    }
  }
  if (ctx.playerPos) {
    const dx = pos.x - ctx.playerPos.x;
    const dz = pos.z - ctx.playerPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.81 && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      dodgeX += (dx / d) * 2.4;
      dodgeZ += (dz / d) * 2.4;
    }
  }
  if (dodgeX !== 0 || dodgeZ !== 0) {
    ped.dodgeX = dodgeX;
    ped.dodgeZ = dodgeZ;
    ped.dodgeT = 0.55;
  } else if (ped.dodgeT > 0) {
    ped.dodgeT -= dt;
  }
  if (ped.hurryT > 0) ped.hurryT -= dt;

  // Stroll toward the current corner, with any dodge layered on top.
  let tx = ped.target.x - pos.x;
  let tz = ped.target.z - pos.z;
  if (Math.hypot(tx, tz) < 0.45) {
    decideNext(ped);
    tx = ped.target.x - pos.x;
    tz = ped.target.z - pos.z;
  }
  const td = Math.hypot(tx, tz);
  const speed = ped.speed * (ped.hurryT > 0 ? 1.85 : 1);
  let vx = td > 0.01 ? (tx / td) * speed : 0;
  let vz = td > 0.01 ? (tz / td) * speed : 0;
  if (ped.dodgeT > 0) {
    vx += ped.dodgeX;
    vz += ped.dodgeZ;
  }

  const vlen = Math.hypot(vx, vz);
  if (vlen > 0.05) {
    ped.heading = turnToward(ped.heading, Math.atan2(vx, vz), dt * 10);
    moveWithCollision(pos, PED.radius, vx * dt, vz * dt, ctx.world.colliders, ctx.world.bounds);
    animateWalk(ped, dt, vlen);
  } else {
    ped.group.rotation.y = ped.heading;
  }
}

/**
 * Advance every pedestrian by dt. ctx is { world, cars, playerPos, playerCar,
 * events }: the world for collisions, every car in the city (they dodge the moving
 * ones and are knocked down by the fast ones), the player's on-foot position (or
 * null while driving), the car he is driving (or null), and an array that knockdown
 * events are pushed onto as { type: 'pedHit', byPlayer }.
 */
export function updatePedestrians(peds, dt, ctx) {
  for (const ped of peds) stepPedestrian(ped, dt, ctx);
}

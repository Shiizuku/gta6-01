// The on-foot character: a simple low-poly person (legs, torso, arms, head, cap) who
// walks or sprints around Port Azura, turns toward where he is heading, swings his limbs
// as he goes, and slides along building walls instead of sticking to them.

import { PLAYER } from './config.js';
import { moveWithCollision } from './world.js';

const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
const shirtMaterial = new THREE.MeshLambertMaterial({ color: 0x2fa3a0 });
const pantsMaterial = new THREE.MeshLambertMaterial({ color: 0x2c3242 });
const capMaterial = new THREE.MeshLambertMaterial({ color: 0xc23b2e });

function limb(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Shortest signed turn from one heading to another, in (-PI, PI]. */
export function turnToward(current, target, maxStep) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + Math.min(maxStep, Math.max(-maxStep, diff));
}

export function createPlayer(scene, x, z) {
  const group = new THREE.Group();

  // Legs pivot at the hip so the walk cycle can swing them.
  const legGeometry = new THREE.CylinderGeometry(0.09, 0.1, 0.78, 8);
  legGeometry.translate(0, -0.39, 0);
  const legL = limb(legGeometry, pantsMaterial, -0.12, 0.8, 0);
  const legR = limb(legGeometry, pantsMaterial, 0.12, 0.8, 0);
  group.add(legL, legR);

  const torso = limb(new THREE.CylinderGeometry(0.19, 0.24, 0.68, 10), shirtMaterial, 0, 1.12, 0);
  group.add(torso);

  // Arms pivot at the shoulder and swing against the legs.
  const armGeometry = new THREE.CylinderGeometry(0.06, 0.07, 0.62, 8);
  armGeometry.translate(0, -0.31, 0);
  const armL = limb(armGeometry, shirtMaterial, -0.3, 1.42, 0);
  const armR = limb(armGeometry, shirtMaterial, 0.3, 1.42, 0);
  group.add(armL, armR);

  const head = limb(new THREE.SphereGeometry(0.16, 12, 10), skinMaterial, 0, 1.64, 0);
  group.add(head);
  const cap = limb(new THREE.CylinderGeometry(0.17, 0.18, 0.08, 12), capMaterial, 0, 1.76, 0);
  group.add(cap);

  group.position.set(x, 0, z);
  scene.add(group);
  return { group, heading: 0, walkPhase: 0, parts: { legL, legR, armL, armR } };
}

/**
 * Advance the character by dt. move is a normalised world-space direction {x, z} or
 * null when standing still. The character turns to face his movement, walks (or sprints
 * with Shift), and his limbs swing in time with his stride.
 */
export function updatePlayer(player, dt, move, sprint, world) {
  const pos = player.group.position;
  if (move) {
    const target = Math.atan2(move.x, move.z);
    player.heading = turnToward(player.heading, target, dt * 11);
    const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    moveWithCollision(pos, PLAYER.radius, move.x * speed * dt, move.z * speed * dt, world.colliders, world.bounds);
    player.walkPhase += dt * speed * 1.9;
  } else {
    // Settle the limbs back to rest.
    player.walkPhase = 0;
  }
  const swing = move ? Math.sin(player.walkPhase) * 0.55 : 0;
  player.parts.legL.rotation.x = swing;
  player.parts.legR.rotation.x = -swing;
  player.parts.armL.rotation.x = -swing * 0.8;
  player.parts.armR.rotation.x = swing * 0.8;
  player.group.rotation.y = player.heading;
}

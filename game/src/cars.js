// Cars: how one looks (makeCar), where the parked ones rest (spawnParkedCars), and the
// arcade driving model (updateCar). A car is a plain object { group, heading, speed }:
// the group is its THREE object, heading is its facing (its nose points along
// (sin heading, 0, cos heading)), and speed is signed metres per second.

import { CAR, CITY } from './config.js';
import { moveWithCollision } from './world.js';

export const PAINT = [0xc23b2e, 0x2e6fc2, 0xd9d9d9, 0x30343c, 0x3fae6a, 0xd9a441, 0x7a4fa3, 0xb8b0a4, 0x845c2c, 0x39665e];

const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x10151f });
const tyreMaterial = new THREE.MeshLambertMaterial({ color: 0x14161a });
const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
const taillightMaterial = new THREE.MeshBasicMaterial({ color: 0xff4b3e });

const bodyGeometry = new THREE.BoxGeometry(1.8, 0.55, 4.3);
const cabinGeometry = new THREE.BoxGeometry(1.6, 0.5, 2.0);
const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
const lightGeometry = new THREE.BoxGeometry(0.32, 0.12, 0.06);

export function makeCar(colour) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: colour });

  const body = new THREE.Mesh(bodyGeometry, paint);
  body.position.y = 0.55;
  group.add(body);

  const cabin = new THREE.Mesh(cabinGeometry, glassMaterial);
  cabin.position.set(0, 1.06, -0.25);
  group.add(cabin);

  for (const sx of [-0.85, 0.85]) {
    for (const sz of [-1.45, 1.45]) {
      const wheel = new THREE.Mesh(wheelGeometry, tyreMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.36, sz);
      group.add(wheel);
    }
  }
  for (const sx of [-0.58, 0.58]) {
    const head = new THREE.Mesh(lightGeometry, headlightMaterial);
    head.position.set(sx, 0.62, 2.16);
    group.add(head);
    const tail = new THREE.Mesh(lightGeometry, taillightMaterial);
    tail.position.set(sx, 0.62, -2.16);
    group.add(tail);
  }
  return group;
}

/**
 * Place the parked cars along the curbs of the road grid: on a road line, offset to one
 * side, facing along the road, never too near an intersection or another parked car.
 * Returns the car objects in spawn order; the player starts beside the first one.
 */
export function spawnParkedCars(scene, rng, world) {
  const cars = [];
  const lines = world.roadLines;
  let guard = 0;
  while (cars.length < CAR.parkedCount && guard < 400) {
    guard += 1;
    const vertical = rng() < 0.5;
    const line = lines[1 + Math.floor(rng() * (lines.length - 2))];
    const side = (rng() < 0.5 ? -1 : 1) * (CITY.roadWidth / 2 - 1.7);
    let along = -148 + rng() * 296;
    // Keep clear of intersections: nudge away from the nearest crossing road line.
    for (const cross of lines) {
      if (Math.abs(along - cross) < 13) along = cross + (along < cross ? -13.5 : 13.5);
    }
    const x = vertical ? line + side : along;
    const z = vertical ? along : line + side;
    if (cars.some((car) => Math.hypot(car.group.position.x - x, car.group.position.z - z) < 8)) continue;
    const heading = vertical
      ? (rng() < 0.5 ? 0 : Math.PI)
      : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const group = makeCar(PAINT[Math.floor(rng() * PAINT.length)]);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    scene.add(group);
    cars.push({ group, heading, speed: 0 });
  }
  return cars;
}

/**
 * Advance one car by dt. input is { throttle: -1..1, steer: -1..1, brake: bool } with
 * steer -1 = left (A), 1 = right (D). Steering bites harder at low speed and fades as
 * the car speeds up; a wall stops the car dead rather than bouncing it.
 */
export function updateCar(car, input, dt, world) {
  if (input.throttle > 0) {
    car.speed += CAR.accel * (car.speed < 0 ? 2.4 : 1) * dt;
  } else if (input.throttle < 0) {
    car.speed -= CAR.accel * (car.speed > 0 ? 2.4 : 0.85) * dt;
  }
  if (input.brake) {
    const decel = CAR.brake * dt;
    car.speed = Math.abs(car.speed) <= decel ? 0 : car.speed - Math.sign(car.speed) * decel;
  }
  // Rolling drag: strong when coasting, gentle under power.
  const drag = input.throttle === 0 && !input.brake ? 1.1 : 0.25;
  car.speed -= car.speed * drag * dt;
  if (input.throttle === 0 && !input.brake && Math.abs(car.speed) < 0.12) car.speed = 0;
  car.speed = Math.min(CAR.maxSpeed, Math.max(-CAR.maxReverse, car.speed));

  if (car.speed !== 0 && input.steer !== 0) {
    const wheel = (input.steer * 0.5) / (1 + Math.abs(car.speed) * 0.05);
    car.heading += (car.speed / 2.7) * Math.tan(wheel) * dt;
  }

  const dx = Math.sin(car.heading) * car.speed * dt;
  const dz = Math.cos(car.heading) * car.speed * dt;
  const hit = moveWithCollision(car.group.position, CAR.radius, dx, dz, world.colliders, world.bounds);
  if (hit) car.speed = 0;
  car.group.rotation.y = car.heading;
}

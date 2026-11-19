// Traffic: self-driving cars on the road grid, each in its own right-hand lane,
// picking a fresh direction at every intersection, slowing for what is ahead, and
// stopping briefly when rammed. F borrows one while it is stopped or crawling;
// handed back, it finds the nearest road a few seconds later and resumes.
//
// A car's route lives in car.ai.st: { axis, line, dir, cross } — travelling along
// road `line` (an index into world.roadLines) on axis 'v' or 'h', in direction dir
// (+1 / -1), toward intersection `cross`. Steering is pure pursuit of a target
// point in its lane: the next intersection, or the corner of the turn it is making.

import { CITY, TRAFFIC } from './config.js';
import { PAINT, makeCar, updateCar } from './cars.js';

const LANE = TRAFFIC.laneOffset;
const TWO_PI = Math.PI * 2;
const IDLE_INPUT = { throttle: 0, steer: 0, brake: false };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Shortest signed turn from heading b to heading a, in (-PI, PI]. */
function angleDiff(a, b) {
  let diff = (a - b) % TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return diff;
}

/** The point at the intersection ahead of the car, centred in its own lane. */
function legTarget(lines, st) {
  if (st.axis === 'v') return { x: lines[st.line] - st.dir * LANE, z: lines[st.cross] };
  return { x: lines[st.cross], z: lines[st.line] + st.dir * LANE };
}

/** Where the car's lane meets the lane it is turning into: the corner it must round. */
function cornerTarget(lines, st, newDir) {
  if (st.axis === 'v') {
    return { x: lines[st.line] - st.dir * LANE, z: lines[st.cross] + newDir * LANE };
  }
  return { x: lines[st.cross] - newDir * LANE, z: lines[st.line] + st.dir * LANE };
}

/** Scatter the traffic cars over the road grid, each mid-block in its own lane and
 * already rolling. `avoid` is a list of {x, z} points spawns keep clear of. */
export function spawnTraffic(scene, rng, world, avoid = []) {
  const lines = world.roadLines;
  const cars = [];
  let guard = 0;
  while (cars.length < TRAFFIC.count && guard < 600) {
    guard += 1;
    const axis = rng() < 0.5 ? 'v' : 'h';
    const line = Math.floor(rng() * lines.length);
    const dir = rng() < 0.5 ? 1 : -1;
    const seg = Math.floor(rng() * (lines.length - 1));
    const along = lines[seg] + (0.3 + rng() * 0.4) * CITY.pitch;
    const x = axis === 'v' ? lines[line] - dir * LANE : along;
    const z = axis === 'v' ? along : lines[line] + dir * LANE;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
    if (cars.some((car) => Math.hypot(car.group.position.x - x, car.group.position.z - z) < 10)) continue;

    const heading = axis === 'v' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const group = makeCar(PAINT[Math.floor(rng() * PAINT.length)]);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    scene.add(group);

    const cruise = TRAFFIC.cruiseMin + rng() * (TRAFFIC.cruiseMax - TRAFFIC.cruiseMin);
    const st = { axis, line, dir, cross: dir > 0 ? seg + 1 : seg };
    const car = { group, heading, speed: cruise * 0.5 };
    car.ai = {
      st,
      target: legTarget(lines, st),
      kind: 'leg', // 'leg' | 'corner'
      pendingTurn: null,
      cruise,
      rng,
      startled: 0,
      stuck: 0,
      reverse: 0,
      lastSteer: 0,
      driven: false,
      needReplan: false,
      resumeAt: 0,
    };
    cars.push(car);
  }
  return cars;
}

/** The player takes the wheel of a traffic car: its rounds pause until releaseCar. */
export function claimCar(car) {
  if (!car.ai) return;
  car.ai.driven = true;
  car.ai.needReplan = false;
}

/** The player hands a traffic car back: it waits, then re-plans from wherever it is. */
export function releaseCar(car, now) {
  if (!car.ai) return;
  car.ai.driven = false;
  car.ai.needReplan = true;
  car.ai.resumeAt = now + TRAFFIC.resumeDelay;
}

/** Choose what the car does at the intersection it is approaching, and retarget it. */
function decideManeuver(car, lines) {
  const ai = car.ai;
  const st = ai.st;
  const last = lines.length - 1;
  const options = [];
  if (st.cross + st.dir >= 0 && st.cross + st.dir <= last) options.push('straight');
  // From a north-south road a left turn keeps the sign of dir; from an east-west
  // road it flips. Right turns are the mirror image.
  const leftDir = st.axis === 'v' ? st.dir : -st.dir;
  const rightDir = -leftDir;
  if (st.line + leftDir >= 0 && st.line + leftDir <= last) options.push('left');
  if (st.line + rightDir >= 0 && st.line + rightDir <= last) options.push('right');

  const pick = options.length ? options[Math.floor(ai.rng() * options.length)] : 'uturn';
  if (pick === 'straight') {
    st.cross += st.dir;
    ai.target = legTarget(lines, st);
  } else if (pick === 'uturn') {
    // Only at a dead end: swing around and head back the way it came.
    st.dir = -st.dir;
    st.cross += st.dir;
    ai.target = legTarget(lines, st);
  } else {
    const newDir = pick === 'left' ? leftDir : rightDir;
    ai.pendingTurn = {
      axis: st.axis === 'v' ? 'h' : 'v',
      line: st.cross,
      dir: newDir,
      cross: st.line + newDir,
    };
    ai.target = cornerTarget(lines, st, newDir);
    ai.kind = 'corner';
  }
}

/** The car has rounded its corner: adopt the new road and aim at its next crossing. */
function completeTurn(car, lines) {
  const ai = car.ai;
  const turn = ai.pendingTurn;
  ai.st.axis = turn.axis;
  ai.st.line = turn.line;
  ai.st.dir = turn.dir;
  ai.st.cross = turn.cross;
  ai.pendingTurn = null;
  ai.kind = 'leg';
  ai.target = legTarget(lines, ai.st);
}

/** The index of the first road line strictly ahead of coord when travelling in dir. */
function nextCross(lines, coord, dir) {
  if (dir > 0) {
    for (let i = 0; i < lines.length; i += 1) if (lines[i] > coord + 1) return i;
    return lines.length - 1;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i] < coord - 1) return i;
  return 0;
}

/** Rebuild a route from wherever the car sits: aim it at the nearest road, in the
 * direction it is roughly facing. */
function replan(car, world) {
  const lines = world.roadLines;
  const pos = car.group.position;
  let lineV = 0;
  let lineH = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (Math.abs(pos.x - lines[i]) < Math.abs(pos.x - lines[lineV])) lineV = i;
    if (Math.abs(pos.z - lines[i]) < Math.abs(pos.z - lines[lineH])) lineH = i;
  }
  const st = car.ai.st;
  if (Math.abs(pos.x - lines[lineV]) <= Math.abs(pos.z - lines[lineH])) {
    st.axis = 'v';
    st.line = lineV;
    st.dir = Math.cos(car.heading) >= 0 ? 1 : -1;
    st.cross = nextCross(lines, pos.z, st.dir);
  } else {
    st.axis = 'h';
    st.line = lineH;
    st.dir = Math.sin(car.heading) >= 0 ? 1 : -1;
    st.cross = nextCross(lines, pos.x, st.dir);
  }
  car.ai.pendingTurn = null;
  car.ai.kind = 'leg';
  car.ai.target = legTarget(lines, st);
}

/** Fastest speed right now without rear-ending what is ahead. ctx.cars holds every
 * car (parked ones count for less: they hug the kerb); ctx.pedestrians, ctx.playerPos. */
function obstacleLimit(car, ctx) {
  const pos = car.group.position;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = -Math.cos(car.heading);
  const rz = Math.sin(car.heading);
  let limit = Infinity;
  const scan = (ox, oz, latMax, bumperGap) => {
    const relX = ox - pos.x;
    const relZ = oz - pos.z;
    const ahead = relX * fx + relZ * fz;
    const lat = Math.abs(relX * rx + relZ * rz);
    if (ahead < -1 || lat > latMax) return;
    const gap = ahead - bumperGap;
    if (gap < 6) limit = Math.min(limit, gap <= 0.4 ? 0 : car.ai.cruise * (gap / 6));
  };
  for (const other of ctx.cars) {
    if (other === car) continue;
    const p = other.group.position;
    const parkedAtKerb = !other.ai && other !== ctx.playerCar && Math.abs(other.speed) < 0.1;
    scan(p.x, p.z, parkedAtKerb ? 1.15 : 2.05, 3.4);
  }
  for (const ped of ctx.pedestrians) {
    const p = ped.group.position;
    scan(p.x, p.z, 1.9, 2.3);
  }
  if (ctx.playerPos) scan(ctx.playerPos.x, ctx.playerPos.z, 1.9, 2.3);
  return limit;
}

/** A fast car making contact startles a traffic car into stopping for a moment. */
function detectRam(car, ctx) {
  const pos = car.group.position;
  for (const other of ctx.cars) {
    if (other === car || Math.abs(other.speed) < 2.2) continue;
    const p = other.group.position;
    if (Math.hypot(p.x - pos.x, p.z - pos.z) < 3.4) {
      car.ai.startled = Math.max(car.ai.startled, 0.9);
      return;
    }
  }
}

function stepCar(car, dt, ctx, lines) {
  const ai = car.ai;
  const pos = car.group.position;

  // Navigation: settle the maneuver for the intersection ahead, then adopt the new
  // road once a turn's corner has been rounded.
  let dx = ai.target.x - pos.x;
  let dz = ai.target.z - pos.z;
  let dist = Math.hypot(dx, dz);
  if (ai.kind === 'leg' && dist < 11) decideManeuver(car, lines);
  else if (ai.kind === 'corner' && dist < 3.4) completeTurn(car, lines);
  dx = ai.target.x - pos.x;
  dz = ai.target.z - pos.z;
  dist = Math.hypot(dx, dz);

  // Desired speed: cruise, slower for a corner, stopped while startled or blocked.
  let desired = ai.cruise;
  if (ai.kind === 'corner') desired = Math.min(desired, TRAFFIC.turnSpeed);
  if (ai.startled > 0) {
    ai.startled -= dt;
    desired = 0;
  }
  desired = Math.min(desired, obstacleLimit(car, ctx));

  // Pure-pursuit steering toward the target point.
  const diff = angleDiff(Math.atan2(dx, dz), car.heading);
  let steer = clamp(diff * 1.9, -1, 1);
  if (Math.abs(steer) > 0.05) ai.lastSteer = steer;

  let throttle = 0;
  let brake = false;
  if (ai.reverse > 0) {
    // Unstick: back up briefly, nose swinging the other way, then try again.
    ai.reverse -= dt;
    throttle = -1;
    steer = steer !== 0 ? -steer : ai.lastSteer !== 0 ? -ai.lastSteer : 0.7;
  } else {
    if (car.speed < desired - 0.15) throttle = 1;
    else if (car.speed > desired + 1.2 || (desired === 0 && car.speed > 0.4)) brake = true;
    if (desired > 0.5 && Math.abs(car.speed) < 0.25) {
      ai.stuck += dt;
      if (ai.stuck > 1.6) {
        ai.reverse = 0.8;
        ai.stuck = 0;
      }
    } else {
      ai.stuck = 0;
    }
  }

  updateCar(car, { throttle, steer, brake }, dt, ctx.world);
  detectRam(car, ctx);
}

/** Advance every traffic car by dt. ctx is { world, cars, pedestrians, playerCar,
 * playerPos, now }. */
export function updateTraffic(cars, dt, ctx) {
  const lines = ctx.world.roadLines;
  for (const car of cars) {
    const ai = car.ai;
    if (!ai || ai.driven) continue;
    if (ai.needReplan) {
      // Handed back: roll to a stop, wait, then find the road again.
      updateCar(car, IDLE_INPUT, dt, ctx.world);
      if (ctx.now >= ai.resumeAt) {
        replan(car, ctx.world);
        ai.needReplan = false;
      }
      continue;
    }
    stepCar(car, dt, ctx, lines);
  }
}

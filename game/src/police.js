// Police: Port Azura's finest, such as they are. A police force keeps as many units
// on the street as the wanted level calls for (capped, and none at all at zero stars).
// Units roll in at road positions well away from the player's view, navigate the road
// grid toward the player the way traffic does — except that at every intersection
// they pick the turn that heads most directly at the player — and switch to a direct
// chase when they get close. On foot they box the player in rather than running him
// down; in a car they lean on the bumper and try to block him in.
//
// A unit's route lives in car.police.st exactly like a traffic car's ai.st:
// { axis, line, dir, cross }, plus a mode: 'leg' | 'corner' on the grid, or 'direct'
// when the chase leaves the grid and steers straight at the player.

import { POLICE, TRAFFIC } from './config.js';
import { makeCar, updateCar } from './cars.js';

const LANE = TRAFFIC.laneOffset;
const TWO_PI = Math.PI * 2;

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

/** The index of the first road line strictly ahead of coord when travelling in dir. */
function nextCross(lines, coord, dir) {
  if (dir > 0) {
    for (let i = 0; i < lines.length; i += 1) if (lines[i] > coord + 1) return i;
    return lines.length - 1;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i] < coord - 1) return i;
  return 0;
}

/** A black-and-white patrol car: a makeCar in dark paint, white door panels, and a
 * red/blue light bar whose materials the update loop flashes while pursuing. */
function makePoliceCar(scene) {
  const group = makeCar(0x16181d);
  const panelMaterial = new THREE.MeshLambertMaterial({ color: 0xe8ecf0 });
  const panelGeometry = new THREE.BoxGeometry(0.05, 0.38, 1.7);
  for (const sx of [-0.92, 0.92]) {
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.position.set(sx, 0.58, -0.1);
    group.add(panel);
  }
  const barBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.04, 0.06, 0.36),
    new THREE.MeshLambertMaterial({ color: 0x0c0e12 }),
  );
  barBase.position.set(0, 1.34, -0.25);
  group.add(barBase);
  const lampGeometry = new THREE.BoxGeometry(0.46, 0.11, 0.3);
  const redMat = new THREE.MeshBasicMaterial({ color: 0x4d0d0d });
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x0d1a4d });
  const red = new THREE.Mesh(lampGeometry, redMat);
  red.position.set(-0.27, 1.42, -0.25);
  group.add(red);
  const blue = new THREE.Mesh(lampGeometry, blueMat);
  blue.position.set(0.27, 1.42, -0.25);
  group.add(blue);
  scene.add(group);
  return { group, lights: { red: redMat, blue: blueMat } };
}

/** Begin a turn at the intersection ahead: aim at the corner point of the new lane. */
function startTurn(car, lines, newDir) {
  const P = car.police;
  const st = P.st;
  P.pendingTurn = {
    axis: st.axis === 'v' ? 'h' : 'v',
    line: st.cross,
    dir: newDir,
    cross: st.line + newDir,
  };
  P.target = cornerTarget(lines, st, newDir);
  P.kind = 'corner';
}

/** The unit has rounded its corner: adopt the new road and aim at its next crossing. */
function completeTurn(car, lines) {
  const P = car.police;
  const turn = P.pendingTurn;
  P.st.axis = turn.axis;
  P.st.line = turn.line;
  P.st.dir = turn.dir;
  P.st.cross = turn.cross;
  P.pendingTurn = null;
  P.kind = 'leg';
  P.target = legTarget(lines, P.st);
}

/**
 * Choose the maneuver at the intersection ahead — straight, left, right, or (only
 * when nothing else points the right way) a U-turn — by which resulting travel
 * direction points most closely at the player.
 */
function decideManeuver(car, lines, playerPos) {
  const P = car.police;
  const st = P.st;
  const last = lines.length - 1;
  const pos = car.group.position;
  const toX = playerPos.x - pos.x;
  const toZ = playerPos.z - pos.z;
  const toD = Math.hypot(toX, toZ) || 1;
  const options = [];
  const consider = (vx, vz, penalty, apply) => {
    options.push({ score: (vx * toX + vz * toZ) / toD - penalty, apply });
  };
  if (st.cross + st.dir >= 0 && st.cross + st.dir <= last) {
    consider(st.axis === 'v' ? 0 : st.dir, st.axis === 'v' ? st.dir : 0, 0, () => {
      st.cross += st.dir;
      P.target = legTarget(lines, st);
    });
  }
  const leftDir = st.axis === 'v' ? st.dir : -st.dir;
  const rightDir = -leftDir;
  if (st.line + leftDir >= 0 && st.line + leftDir <= last) {
    consider(st.axis === 'v' ? leftDir : 0, st.axis === 'v' ? 0 : leftDir, 0, () => startTurn(car, lines, leftDir));
  }
  if (st.line + rightDir >= 0 && st.line + rightDir <= last) {
    consider(st.axis === 'v' ? rightDir : 0, st.axis === 'v' ? 0 : rightDir, 0, () => startTurn(car, lines, rightDir));
  }
  consider(st.axis === 'v' ? 0 : -st.dir, st.axis === 'v' ? -st.dir : 0, 0.45, () => {
    st.dir = -st.dir;
    st.cross += st.dir;
    P.target = legTarget(lines, st);
  });
  options.sort((a, b) => b.score - a.score);
  options[0].apply();
}

/** Rebuild a grid route from wherever the unit currently sits, facing as it faces. */
function planRoute(car, world) {
  const lines = world.roadLines;
  const pos = car.group.position;
  let lineV = 0;
  let lineH = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (Math.abs(pos.x - lines[i]) < Math.abs(pos.x - lines[lineV])) lineV = i;
    if (Math.abs(pos.z - lines[i]) < Math.abs(pos.z - lines[lineH])) lineH = i;
  }
  const st = car.police.st;
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
  car.police.pendingTurn = null;
  car.police.kind = 'leg';
  car.police.target = legTarget(lines, st);
}

/**
 * The fastest this unit may go without rear-ending whatever is ahead of it. The car
 * the player is driving is deliberately not an obstacle: contact is the point. On
 * foot, the player is not scanned either — the approach-speed formula in stepPolice
 * handles stopping next to him.
 */
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
    if (gap < 6) limit = Math.min(limit, gap <= 0.4 ? 0 : POLICE.cruise * (gap / 6));
  };
  for (const other of ctx.cars) {
    if (other === car || other === ctx.playerCar) continue;
    const p = other.group.position;
    scan(p.x, p.z, 2.05, 3.4);
  }
  for (const ped of ctx.pedestrians) {
    const p = ped.group.position;
    scan(p.x, p.z, 1.9, 2.3);
  }
  return limit;
}

function stepPolice(car, dt, ctx, lines) {
  const P = car.police;
  const pos = car.group.position;
  const pdx = ctx.playerPos.x - pos.x;
  const pdz = ctx.playerPos.z - pos.z;
  const pDist = Math.hypot(pdx, pdz);

  if (P.kind !== 'direct' && pDist < POLICE.directRange) P.kind = 'direct';
  if (P.kind === 'direct' && pDist > POLICE.directExit) planRoute(car, ctx.world);

  let desired = P.cruise;
  if (P.kind === 'direct') {
    P.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
    if (!ctx.playerInCar) {
      // Roll up and stop beside the player, close enough to corner him (the BUSTED
      // meter in main.js does the rest) without mowing him down at full speed.
      if (pDist < 12) desired = Math.max(0, (pDist - 4.2) * 1.1);
    } else if (pDist < 3.1) {
      // Leaning on the player's bumper: match his speed and smother the chase.
      car.speed = Math.min(car.speed, Math.abs(ctx.playerCar ? ctx.playerCar.speed : 0) + 0.6);
    }
  } else {
    const dx = P.target.x - pos.x;
    const dz = P.target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (P.kind === 'leg' && dist < 11) decideManeuver(car, lines, ctx.playerPos);
    else if (P.kind === 'corner' && dist < 3.4) completeTurn(car, lines);
    if (P.kind === 'corner') desired = Math.min(desired, POLICE.cornerSpeed);
  }
  desired = Math.min(desired, obstacleLimit(car, ctx));

  // Pure-pursuit steering toward the target point.
  const diff = angleDiff(Math.atan2(P.target.x - pos.x, P.target.z - pos.z), car.heading);
  let steer = clamp(diff * 1.9, -1, 1);
  if (Math.abs(steer) > 0.05) P.lastSteer = steer;

  let throttle = 0;
  let brake = false;
  if (P.reverse > 0) {
    P.reverse -= dt;
    throttle = -1;
    steer = steer !== 0 ? -steer : P.lastSteer !== 0 ? -P.lastSteer : 0.7;
  } else {
    if (car.speed < desired - 0.15) throttle = 1;
    else if (car.speed > desired + 1.2 || (desired === 0 && car.speed > 0.4)) brake = true;
    if (desired > 0.5 && Math.abs(car.speed) < 0.25) {
      P.stuck += dt;
      if (P.stuck > 1.6) {
        P.reverse = 0.8;
        P.stuck = 0;
      }
    } else {
      P.stuck = 0;
    }
  }
  updateCar(car, { throttle, steer, brake }, dt, ctx.world);

  // The light bar strobes red/blue while there is any heat at all; at zero stars the
  // lamps sit dim and the unit is just another car leaving the area.
  const phase = Math.floor(ctx.now * 5) % 2 === 0;
  if (ctx.wanted > 0) {
    car.lights.red.color.setHex(phase ? 0xff2b2b : 0x4d0d0d);
    car.lights.blue.color.setHex(phase ? 0x0d1a4d : 0x2b6bff);
  } else {
    car.lights.red.color.setHex(0x4d0d0d);
    car.lights.blue.color.setHex(0x0d1a4d);
  }
}

/**
 * Create the police force for a city. update(dt, ctx) keeps the unit count matched
 * to the wanted level and steps every unit; ctx is { world, cars, pedestrians,
 * playerPos, playerInCar, playerCar, viewDir, now, wanted } — every car in the city,
 * the people in it, where the player is (his car when driving), the camera's ground
 * view direction (spawns stay out of it), the clock, and the current star count.
 */
export function createPoliceForce(scene, world, rng) {
  const cars = [];
  let spawnTimer = 0;

  function removeCar(index) {
    scene.remove(cars[index].group);
    cars.splice(index, 1);
  }

  /** Roll one unit in on a road far from the player and out of the camera's view. */
  function trySpawn(ctx) {
    const lines = world.roadLines;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const vertical = rng() < 0.5;
      const lineIdx = Math.floor(rng() * lines.length);
      const along = -150 + rng() * 300;
      let x;
      let z;
      let dir;
      if (vertical) {
        dir = ctx.playerPos.z >= along ? 1 : -1;
        x = lines[lineIdx] - dir * LANE;
        z = along;
      } else {
        dir = ctx.playerPos.x >= along ? 1 : -1;
        z = lines[lineIdx] + dir * LANE;
        x = along;
      }
      const dx = x - ctx.playerPos.x;
      const dz = z - ctx.playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < POLICE.spawnMinDist || dist > POLICE.spawnMaxDist) continue;
      // Not in front of the camera: the spawn direction must not align with view.
      if ((dx * ctx.viewDir.x + dz * ctx.viewDir.z) / dist > 0.25) continue;
      if (cars.some((c) => Math.hypot(c.group.position.x - x, c.group.position.z - z) < 14)) continue;

      const { group, lights } = makePoliceCar(scene);
      group.position.set(x, 0, z);
      const heading = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      group.rotation.y = heading;
      const st = vertical
        ? { axis: 'v', line: lineIdx, dir, cross: nextCross(lines, z, dir) }
        : { axis: 'h', line: lineIdx, dir, cross: nextCross(lines, x, dir) };
      const car = { group, heading, speed: POLICE.cruise * 0.4, lights };
      car.police = {
        st,
        target: legTarget(lines, st),
        kind: 'leg', // 'leg' | 'corner' | 'direct'
        pendingTurn: null,
        cruise: POLICE.cruise,
        stuck: 0,
        reverse: 0,
        lastSteer: 0,
      };
      cars.push(car);
      return true;
    }
    return false;
  }

  return {
    cars,
    /** Remove every unit at once (the player respawns across town after an arrest). */
    clear() {
      for (let i = cars.length - 1; i >= 0; i -= 1) removeCar(i);
    },
    update(dt, ctx) {
      const lines = world.roadLines;
      // Despawn: hopelessly far at any heat, or merely far once the heat is gone.
      for (let i = cars.length - 1; i >= 0; i -= 1) {
        const p = cars[i].group.position;
        const d = Math.hypot(p.x - ctx.playerPos.x, p.z - ctx.playerPos.z);
        if (d > 175 || (ctx.wanted <= 0 && d > 45)) removeCar(i);
      }
      const target = ctx.wanted > 0 ? Math.min(ctx.wanted, POLICE.maxActive) : 0;
      spawnTimer -= dt;
      if (cars.length < target && spawnTimer <= 0) {
        spawnTimer = trySpawn(ctx) ? POLICE.spawnInterval : 0.3;
      }
      for (const car of cars) stepPolice(car, dt, ctx, lines);
    },
  };
}

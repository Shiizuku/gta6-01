// Police: units roll in on the road grid toward the player, turning at each
// intersection toward him, then a direct chase up close; on foot they box him in,
// in a car they lean on his bumper. Route state lives in car.police.st, like a
// traffic car's ai.st: { axis, line, dir, cross }, mode 'leg' | 'corner' | 'direct'.

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

/** A black-and-white patrol car, light bar flashing while pursuing. */
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

// Police helicopter: dark-blue body, white belly, tail boom + fin, spinning main
// and tail rotors, flashing beacon, searchlight (SpotLight + faint cone) tracking
// the player. It only watches — never shoots.
function makeHeli(scene) {
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const dark = lam(0x1c2f4d);
  add(new THREE.BoxGeometry(4.4, 1.5, 2.2), dark, 0, 0.4, 0);
  add(new THREE.BoxGeometry(3.4, 0.7, 1.8), lam(0xe8ecf0), 0, -0.4, 0);
  add(new THREE.BoxGeometry(4.4, 0.7, 0.7), dark, -4.1, 0.7, 0);
  add(new THREE.BoxGeometry(0.5, 1.6, 0.2), dark, -6.1, 1.1, 0);
  const rotor = add(new THREE.BoxGeometry(9.5, 0.08, 0.5), lam(0x0c0e12), 0, 1.35, 0);
  const tailRotor = add(new THREE.BoxGeometry(0.08, 1.7, 0.3), lam(0x0c0e12), -6.1, 0.9, 0.45);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2b2b });
  add(new THREE.SphereGeometry(0.22, 8, 6), beaconMat, 0, 1.3, 0);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfff2b0, transparent: true, opacity: 0.08,
    side: THREE.DoubleSide, depthWrite: false,
  });
  add(new THREE.ConeGeometry(7, 40, 16, 1, true), coneMat, 0, -20, 0);
  const spot = new THREE.SpotLight(0xfff2b0, 0.8, 95, 0.32, 0.5, 1);
  const spotTarget = new THREE.Object3D();
  scene.add(spotTarget);
  spot.target = spotTarget;
  g.add(spot);
  scene.add(g);
  return {
    group: g, rotor, tailRotor, beaconMat, coneMat, spot, spotTarget,
    leaving: false, dir: null, t: 0,
  };
}

function stepHeli(h, dt, ctx) {
  h.t += dt;
  const p = h.group.position;
  const dark = ctx.dark || 0;
  h.rotor.rotation.y += dt * 22;
  h.tailRotor.rotation.x += dt * 30;
  h.beaconMat.color.setHex(Math.floor(h.t * 3) % 2 === 0 ? 0xff2b2b : 0x4d0d0d);
  const bankTo = (roll) => {
    h.group.rotation.z += (roll - h.group.rotation.z) * Math.min(1, dt * 2);
  };
  if (h.leaving) {
    if (!h.dir) {
      const dx = p.x - ctx.playerPos.x;
      const dz = p.z - ctx.playerPos.z;
      const d = Math.hypot(dx, dz) || 1;
      h.dir = { x: dx / d, z: dz / d };
    }
    p.x += h.dir.x * 26 * dt;
    p.z += h.dir.z * 26 * dt;
    p.y += (70 - p.y) * Math.min(1, dt * 1.5);
    h.group.rotation.y = Math.atan2(h.dir.x, h.dir.z);
    bankTo(0.22);
    // The beam dies as it pulls away: the chase is over.
    const fade = Math.max(0, 1 - dt * 1.5);
    h.spot.intensity *= fade;
    h.coneMat.opacity *= fade;
    return;
  }
  h.dir = null; // leaving again later picks a fresh direction away from the player
  // Slow orbit above the player, ~40 m up and banked into the turn; the beam follows him.
  const a = h.t * 0.35;
  const tx = ctx.playerPos.x + Math.cos(a) * 8;
  const tz = ctx.playerPos.z + Math.sin(a) * 8;
  const k = Math.min(1, dt * 1.2);
  p.x += (tx - p.x) * k;
  p.z += (tz - p.z) * k;
  p.y += (40 - p.y) * Math.min(1, dt * 1.5);
  h.group.rotation.y = Math.atan2(ctx.playerPos.x - p.x, ctx.playerPos.z - p.z);
  bankTo(0.18);
  h.spotTarget.position.set(ctx.playerPos.x, 0, ctx.playerPos.z);
  // Ease the beam toward dusk brightness (fades back in if recalled mid-departure).
  const ease = Math.min(1, dt * 2);
  h.spot.intensity += (0.7 + dark * 2.2 - h.spot.intensity) * ease;
  h.coneMat.opacity += (0.05 + dark * 0.11 - h.coneMat.opacity) * ease;
}

/** Begin a turn at the intersection ahead. */
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

/** The unit has rounded its corner: adopt the new road. */
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

/** At the intersection ahead, pick the maneuver whose direction points most
 * closely at the player (a U-turn only when nothing else points the right way). */
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

/** Rebuild a grid route from wherever the unit currently sits. */
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

/** Fastest speed without rear-ending what is ahead (the player car and, on foot,
 * the player himself, are deliberately not obstacles: contact is the point). */
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
      // Roll up and stop beside him (the BUSTED meter does the rest).
      if (pDist < 12) desired = Math.max(0, (pDist - 4.2) * 1.1);
    } else if (pDist < 3.1) {
      // Lean on his bumper: match his speed and smother the chase.
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

  // The light bar strobes red/blue while there is any heat at all.
  const phase = Math.floor(ctx.now * 5) % 2 === 0;
  if (ctx.wanted > 0) {
    car.lights.red.color.setHex(phase ? 0xff2b2b : 0x4d0d0d);
    car.lights.blue.color.setHex(phase ? 0x0d1a4d : 0x2b6bff);
  } else {
    car.lights.red.color.setHex(0x4d0d0d);
    car.lights.blue.color.setHex(0x0d1a4d);
  }
}

/** Create the police force. update(dt, ctx) keeps the unit count matched to the
 * wanted level and steps every unit; ctx is { world, cars, pedestrians, playerPos,
 * playerInCar, playerCar, viewDir, now, wanted, dark }.
 */
export function createPoliceForce(scene, world, rng) {
  const cars = [];
  let spawnTimer = 0;
  let heli = null;

  function removeCar(index) {
    scene.remove(cars[index].group);
    cars.splice(index, 1);
  }

  function removeHeli() {
    scene.remove(heli.group);
    scene.remove(heli.spotTarget);
    heli = null;
  }

  /** Roll one unit in on a road far from the player, out of the camera's view. */
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
    get heliActive() { return !!heli && !heli.leaving; },
    get heliPos() {
      return heli
        ? { x: heli.group.position.x, y: heli.group.position.y, z: heli.group.position.z }
        : null;
    },
    /** Remove every unit at once (the player respawns across town after an arrest). */
    clear() {
      for (let i = cars.length - 1; i >= 0; i -= 1) removeCar(i);
      if (heli) removeHeli();
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
      // At 4+ stars a helicopter joins the chase; below 3 it flies off. While it
      // circles overhead, ground units roll in a little faster.
      if (ctx.wanted >= 4 && !heli) {
        heli = makeHeli(scene);
        heli.group.position.set(ctx.playerPos.x + 60, 40, ctx.playerPos.z - 60);
      }
      if (heli) heli.leaving = ctx.wanted < 3;
      if (heli) {
        stepHeli(heli, dt, ctx);
        const hp = heli.group.position;
        if (heli.leaving && Math.hypot(hp.x - ctx.playerPos.x, hp.z - ctx.playerPos.z) > 200) {
          removeHeli();
        }
      }
      spawnTimer -= dt;
      if (cars.length < target && spawnTimer <= 0) {
        const iv = heli && !heli.leaving ? POLICE.spawnInterval * 0.55 : POLICE.spawnInterval;
        spawnTimer = trySpawn(ctx) ? iv : 0.3;
      }
      for (const car of cars) stepPolice(car, dt, ctx, lines);
    },
  };
}

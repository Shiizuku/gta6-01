// Neon Harbor: Port Azura — boot, game loop, camera, cars, HUD, minimap, wanted.
// ?seed=N fixes the layout (default 1). ?shot=start|play stages title / in-game
// and sets window.__shotReady once the staged frame has painted.

import { CAMERA, CAR, CITY, DAY, HEALTH, PLAYER, POLICE, START_HEALTH, START_MONEY, WANTED } from './config.js';
import { createRandom } from './random.js';
import { buildWorld, circleHits, moveWithCollision } from './world.js';
import { spawnParkedCars, updateCar } from './cars.js';
import { claimCar, releaseCar, spawnTraffic, updateTraffic } from './traffic.js';
import { spawnPedestrians, startlePedestrian, updatePedestrians } from './pedestrians.js';
import { createPoliceForce } from './police.js';
import { createWanted, hasLineOfSight, reportCrime, setWanted, updateWanted } from './wanted.js';
import { createMissions, MARISOL } from './missions.js';
import { createRaces } from './races.js';
import { createStanding, districtAt } from './standing.js';
import { createTaxi } from './taxi.js';
import { createStashes } from './stashes.js';
import { createWeapons } from './weapons.js';
import { clearSave, loadSave, writeSave } from './save.js';
import { createAudio } from './audio.js';
import { createPlayer, turnToward, updatePlayer } from './player.js';
import { endFrame, isDown, wasPressed } from './input.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const container = document.getElementById('game');
const status = document.getElementById('status');
const titleEl = document.getElementById('title');
const moneyEl = document.getElementById('money');
const healthEl = document.getElementById('healthfill');
const wantedEl = document.getElementById('wanted');
const bustedWrap = document.getElementById('bustedwrap');
const bustedFill = document.getElementById('bustedfill');
const endcardEl = document.getElementById('endcard');
const endTitleEl = document.getElementById('endtitle');
const endSubEl = document.getElementById('endsub');
const hintEl = document.getElementById('hint');
const raceEl = document.getElementById('racetimer');
const districtEl = document.getElementById('district');
const stashEl = document.getElementById('stash');
const weaponEl = document.getElementById('weapon');
const crossEl = document.getElementById('crosshair');
const standFillEl = document.getElementById('standfill');
const objectiveEl = document.getElementById('objective');
const missioncardEl = document.getElementById('missioncard');
const mcardTitleEl = document.getElementById('mcardtitle');
const mcardLineEl = document.getElementById('mcardline');
const pausedEl = document.getElementById('paused');
const startBtn = document.getElementById('start');
const continueBtn = document.getElementById('continue');
const minimap = document.getElementById('minimap');
const mapCtx = minimap.getContext('2d');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);

const world = buildWorld(scene, createRandom(seed));
const cars = spawnParkedCars(scene, createRandom(seed * 7919 + 13), world);

// The player starts beside the first parked car, on its road side, so neither
// the player nor the opening camera starts inside a building.
const firstCar = cars[0];
const carPos = firstCar.group.position;
const onVerticalRoad = Math.abs(Math.sin(firstCar.heading)) < 0.5;
let spawnX = carPos.x;
let spawnZ = carPos.z;
if (onVerticalRoad) {
  const lineX = Math.round(carPos.x / CITY.pitch) * CITY.pitch;
  spawnX = carPos.x - Math.sign(carPos.x - lineX) * 2.4;
} else {
  const lineZ = Math.round(carPos.z / CITY.pitch) * CITY.pitch;
  spawnZ = carPos.z - Math.sign(carPos.z - lineZ) * 2.4;
}
const player = createPlayer(scene, spawnX, spawnZ);
player.heading = firstCar.heading + Math.PI;

// The living city: self-driving traffic and pedestrians on the sidewalks.
const trafficCars = spawnTraffic(scene, createRandom(seed * 104729 + 7), world, [
  ...cars.map((car) => car.group.position),
  player.group.position,
]);
const pedestrians = spawnPedestrians(scene, createRandom(seed * 31337 + 101));
const allCars = [...cars, ...trafficCars];

// Consequences: the heat, the force that answers it, and the player's body.
const wanted = createWanted();
const police = createPoliceForce(scene, world, createRandom(seed * 5557 + 3));

// Work, memory, and noise: Marisol's job chain, the saved run, the pocket synth.
const missions = createMissions(scene, cars);
const standing = createStanding();
const races = createRaces(scene, standing);
const taxi = createTaxi(scene, standing);
const stashes = createStashes(scene);
const weapons = createWeapons(scene);
const audio = createAudio();
let paused = false;
let saveTimer = 0;
let bootSave = loadSave();
if (bootSave) {
  // A returning player gets the choice: pick the old run up, or burn it and start over.
  continueBtn.classList.remove('hidden');
  startBtn.textContent = 'NEW GAME';
}
let bustedMeter = 0; // 0..1 while a unit has the on-foot player cornered
let lastDamageAt = -99; // game clock of the last hit taken (drives regeneration)
let lastHurtAt = -99; // game clock of the last car impact (impact invulnerability)
let punchCooldown = 0;
let punchAnimT = 0;
let mousePunch = false;
let endKind = null; // 'busted' | 'wasted' while the end card is up

let state = 'title'; // 'title' | 'playing' | 'over'
let mode = 'foot'; // 'foot' | 'car'
let activeCar = null;
let health = START_HEALTH;
let money = START_MONEY;

let camYaw = firstCar.heading + Math.PI;
let camPitch = 0.34;
let camDist = CAMERA.footDistance;
let lastDragAt = -10;
let elapsed = 0;

// Camera orbit input: drag to orbit, wheel to zoom. A press while playing on
// foot also attacks (the drag and the swing coexist happily).
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true;
  renderer.domElement.setPointerCapture(event.pointerId);
  if (state === 'playing' && mode === 'foot') mousePunch = true;
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  camYaw -= event.movementX * 0.005;
  camPitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, camPitch + event.movementY * 0.004));
  lastDragAt = elapsed;
});
renderer.domElement.addEventListener('pointerup', () => {
  dragging = false;
});
renderer.domElement.addEventListener('wheel', (event) => {
  camDist = Math.min(CAMERA.maxDistance, Math.max(CAMERA.minDistance, camDist + Math.sign(event.deltaY) * 1.6));
  lastDragAt = elapsed;
}, { passive: true });

function announce(message) {
  status.textContent = message;
}

function applySave(data) {
  money = data.money;
  health = Math.min(START_HEALTH, Math.max(1, data.health));
  missions.setProgress(data.missionsCompleted);
  races.setResults(data.races);
  standing.setValues(data.standing);
  taxi.setResults(data.taxi);
  stashes.setFound(data.stashes);
  if (data.seed !== seed || !data.player) return; // Another city's save: keep the vitals, spawn fresh.
  if (data.car && allCars[data.car.index]) {
    const car = allCars[data.car.index];
    car.group.position.set(data.car.x, 0, data.car.z);
    car.heading = data.car.heading;
    car.group.rotation.y = data.car.heading;
    car.speed = 0;
    player.group.position.set(data.car.x, 0, data.car.z);
    activeCar = car;
    mode = 'car';
    claimCar(car);
    player.group.visible = false;
    camDist = CAMERA.carDistance;
    camYaw = data.car.heading + Math.PI;
  } else {
    player.group.position.set(data.player.x, 0, data.player.z);
    player.heading = data.player.heading;
    player.group.rotation.y = data.player.heading;
    camYaw = data.player.heading + Math.PI;
  }
}

/** Record the run as it stands. Screenshot staging never saves (it would clobber). */
function saveNow() {
  if (shot) return;
  const f = focus();
  writeSave({
    money,
    health: Math.round(health),
    missionsCompleted: missions.progress,
    storyDone: missions.storyDone,
    races: races.serialize(),
    standing: standing.serialize(),
    taxi: taxi.serialize(),
    stashes: stashes.serialize(),
    seed,
    player: { x: f.pos.x, z: f.pos.z, heading: player.heading },
    car: activeCar
      ? {
        index: allCars.indexOf(activeCar),
        x: activeCar.group.position.x,
        z: activeCar.group.position.z,
        heading: activeCar.heading,
      }
      : null,
  });
}

function startGame(withSave = false) {
  if (withSave && bootSave) applySave(bootSave);
  state = 'playing';
  titleEl.classList.add('hidden');
  audio.unlock(); // The click that got us here is the gesture the audio policy wants.
  announce(withSave ? 'Welcome back to Port Azura.' : 'Exploring Port Azura on foot. F enters the nearest car.');
}

startBtn.addEventListener('click', () => {
  clearSave();
  bootSave = null;
  startGame(false);
});
continueBtn.addEventListener('click', () => startGame(true));

function nearestCar(maxDist) {
  const pos = player.group.position;
  let best = null;
  let bestDist = maxDist;
  for (const car of allCars) {
    // A traffic car can only be borrowed while it is stopped or crawling.
    if (car.ai && Math.abs(car.speed) > 1.5) continue;
    const d = Math.hypot(car.group.position.x - pos.x, car.group.position.z - pos.z);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

function enterCar(car) {
  // Taking a car is only a crime when somebody sees it.
  const pos = car.group.position;
  const witnessed = pedestrians.some((ped) => Math.hypot(
    ped.group.position.x - pos.x,
    ped.group.position.z - pos.z,
  ) < 20) || police.cars.some((unit) => Math.hypot(
    unit.group.position.x - pos.x,
    unit.group.position.z - pos.z,
  ) < 40);
  if (witnessed) reportCrime(wanted, 'steal', elapsed);
  mousePunch = false;
  activeCar = car;
  mode = 'car';
  claimCar(car);
  player.group.visible = false;
  camDist = CAMERA.carDistance;
  announce('Driving. F gets out.');
}

function exitCar() {
  const car = activeCar;
  const pos = car.group.position;
  // Step out on the car's right; fall back to its left if a wall is in the way.
  const right = { x: -Math.cos(car.heading), z: Math.sin(car.heading) };
  const spot = { x: pos.x + right.x * 2.3, z: pos.z + right.z * 2.3 };
  if (circleHits(spot, 0.45, world.colliders)) {
    spot.x = pos.x - right.x * 2.3;
    spot.z = pos.z - right.z * 2.3;
  }
  spot.x = Math.min(world.bounds.maxX, Math.max(world.bounds.minX, spot.x));
  spot.z = Math.min(world.bounds.maxZ, Math.max(world.bounds.minZ, spot.z));
  player.group.position.set(spot.x, 0, spot.z);
  player.heading = car.heading;
  player.group.visible = true;
  releaseCar(car, elapsed);
  activeCar = null;
  mode = 'foot';
  camDist = CAMERA.footDistance;
  announce('On foot. F enters the nearest car.');
}

/** The thing the camera follows and the minimap centres on. */
function focus() {
  if (mode === 'car' && activeCar) {
    return { pos: activeCar.group.position, heading: activeCar.heading };
  }
  return { pos: player.group.position, heading: player.heading };
}

/** Take a hit: lose the health, get shoved away from whatever dealt it, maybe die. */
function damagePlayer(amount, awayX, awayZ) {
  health -= amount;
  lastDamageAt = elapsed;
  lastHurtAt = elapsed;
  moveWithCollision(player.group.position, PLAYER.radius, awayX * 1.2, awayZ * 1.2, world.colliders, world.bounds);
  if (health <= 0) {
    health = 0;
    doWasted();
  }
}

function showEndcard(kind, title, sub) {
  endKind = kind;
  state = 'over';
  endTitleEl.textContent = title;
  endSubEl.textContent = sub;
  endcardEl.classList.toggle('wasted', kind === 'wasted');
  endcardEl.classList.remove('hidden');
  bustedWrap.style.display = 'none';
}

function doBusted() {
  const lost = money - Math.floor(money * 0.85);
  money -= lost;
  showEndcard('busted', 'BUSTED', `The Port Azura police relieve you of $${lost} in fines and impound fees. You are dropped at the harbour to think it over.`);
  announce(`Busted. The police take $${lost}.`);
}

function doWasted() {
  const lost = money - Math.floor(money * 0.9);
  money -= lost;
  showEndcard('wasted', 'WASTED', `You come to on the harbour quay with a $${lost} hospital bill and no memory of the ambulance.`);
  announce(`Wasted. The hospital takes $${lost}.`);
}

/** Dismiss the end card: settle the outcome and put the player back at the quay. */
function dismissEndcard() {
  if (state !== 'over') return;
  endcardEl.classList.add('hidden');
  if (endKind === 'busted') {
    setWanted(wanted, 0);
    bustedMeter = 0;
  }
  if (endKind === 'wasted') health = START_HEALTH;
  endKind = null;
  if (mode === 'car') {
    // Neither outcome can strike a driver, but never respawn inside a car by accident.
    activeCar = null;
    mode = 'foot';
    player.group.visible = true;
  }
  player.group.position.set(0, 0, 176);
  player.heading = Math.PI;
  player.group.rotation.y = Math.PI;
  camYaw = 0;
  camPitch = 0.34;
  police.clear();
  state = 'playing';
  announce('Back at the harbour. A fresh start, of a kind.');
}

endcardEl.addEventListener('click', dismissEndcard);
window.addEventListener('keydown', () => {
  if (state === 'over') dismissEndcard();
});

/**
 * Per-frame cause and effect while playing: crimes at the wheel, car impacts
 * on foot, and the BUSTED meter filling while a unit has the player cornered.
 */
function updateConsequences(dt) {
  if (mode === 'car' && activeCar) {
    // Crimes at the wheel: ramming the law, and smashing into traffic at speed.
    for (const unit of police.cars) {
      const d = Math.hypot(
        unit.group.position.x - activeCar.group.position.x,
        unit.group.position.z - activeCar.group.position.z,
      );
      if (d < 3.3 && Math.abs(activeCar.speed) > 5 && reportCrime(wanted, 'hitPolice', elapsed)) {
        activeCar.speed *= 0.55;
      }
    }
    for (const other of trafficCars) {
      const d = Math.hypot(
        other.group.position.x - activeCar.group.position.x,
        other.group.position.z - activeCar.group.position.z,
      );
      if (d < 3.1 && Math.abs(activeCar.speed) > 6 && reportCrime(wanted, 'hitTraffic', elapsed)) {
        activeCar.speed *= 0.7;
      }
    }
    bustedMeter = Math.max(0, bustedMeter - dt / 1.2);
    return;
  }

  // On foot, a moving car is an injury waiting to happen — traffic and police alike.
  // Each impact costs health scaled by speed and shoves the player clear.
  const pos = player.group.position;
  for (const car of [...allCars, ...police.cars]) {
    const speed = Math.abs(car.speed);
    if (speed < 3.5) continue;
    const dx = pos.x - car.group.position.x;
    const dz = pos.z - car.group.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 4.2 && elapsed - lastHurtAt > 0.7) {
      const d = Math.sqrt(d2) || 0.01;
      damagePlayer(Math.min(34, (speed - 2.5) * 2.4), dx / d, dz / d);
      if (state !== 'playing') return; // WASTED mid-loop: stop counting.
    }
  }

  // Cornered: a police unit within arm's reach fills the meter; break away and it drains.
  const cornered = wanted.level > 0 && police.cars.some((unit) => Math.hypot(
    unit.group.position.x - pos.x,
    unit.group.position.z - pos.z,
  ) < POLICE.bustRange);
  bustedMeter = cornered
    ? Math.min(1, bustedMeter + dt / POLICE.bustSeconds)
    : Math.max(0, bustedMeter - dt / 1.2);
  if (bustedMeter >= 1) doBusted();
}

function updatePlaying(dt) {
  if (wasPressed('KeyF')) {
    if (mode === 'foot') {
      const car = nearestCar(3.5);
      if (car) enterCar(car);
    } else {
      exitCar();
    }
  }

  // E at a cyan start ring, while driving, joins that street race.
  if (wasPressed('KeyE') && mode === 'car' && races.tryStart(focus().pos, true)) {
    audio.chime();
  }

  // T beside a waiting passenger, while driving, takes the fare.
  if (wasPressed('KeyT') && mode === 'car' && taxi.tryAccept(focus().pos, true)) {
    audio.chime();
  }

  if (mode === 'foot') {
    // WASD relative to where the camera is looking (its ground-plane forward).
    const forward = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
    const right = { x: -forward.z, z: forward.x };
    let mx = 0;
    let mz = 0;
    if (isDown('KeyW') || isDown('ArrowUp')) { mx += forward.x; mz += forward.z; }
    if (isDown('KeyS') || isDown('ArrowDown')) { mx -= forward.x; mz -= forward.z; }
    if (isDown('KeyD') || isDown('ArrowRight')) { mx += right.x; mz += right.z; }
    if (isDown('KeyA') || isDown('ArrowLeft')) { mx -= right.x; mz -= right.z; }
    const len = Math.hypot(mx, mz);
    const move = len > 0 ? { x: mx / len, z: mz / len } : null;
    const sprint = isDown('ShiftLeft') || isDown('ShiftRight');
    updatePlayer(player, dt, move, sprint, world);
    weapons.update(dt, { pos: player.group.position, heading: player.heading, mode, money, health, now: elapsed, audio, camera, pedestrians, police: police.cars, cars: allCars, wanted });

    // Attack: click / J fires the pistol (raycast from the camera) or swings
    // fists / bat at whatever is in front. A hit sends the victim fleeing;
    // a witness turns a punch into a star, a shot always does.
    punchCooldown -= dt;
    if ((wasPressed('KeyJ') || mousePunch) && punchCooldown <= 0) {
      punchCooldown = weapons.weapon === 'pistol' ? 0.28 : 0.38;
      punchAnimT = 0.22;
      if (weapons.weapon === 'pistol') weapons.shoot();
      else {
        const hit = startlePedestrian(pedestrians, player.group.position, player.heading, weapons.weapon === 'bat' ? 2.6 : 1.8);
        if (hit) {
          audio.thud();
          const pos = player.group.position;
          const witnessed = pedestrians.some((ped) => ped !== hit && Math.hypot(
            ped.group.position.x - pos.x,
            ped.group.position.z - pos.z,
          ) < 12) || police.cars.some((unit) => Math.hypot(
            unit.group.position.x - pos.x,
            unit.group.position.z - pos.z,
          ) < 30);
          if (witnessed) reportCrime(wanted, 'punch', elapsed);
        }
      }
    }
    mousePunch = false;
    if (punchAnimT > 0) {
      punchAnimT -= dt;
      const swing = Math.sin((1 - Math.max(0, punchAnimT) / 0.22) * Math.PI);
      player.parts.armR.rotation.x = -2.0 * swing;
    }
  } else if (activeCar) {
    // The 3-2-1 countdown holds the car still: no throttle until GO.
    const input = races.countdownActive
      ? { throttle: 0, steer: 0, brake: true }
      : {
        throttle: (isDown('KeyW') || isDown('ArrowUp') ? 1 : 0) - (isDown('KeyS') || isDown('ArrowDown') ? 1 : 0),
        steer: (isDown('KeyD') || isDown('ArrowRight') ? 1 : 0) - (isDown('KeyA') || isDown('ArrowLeft') ? 1 : 0),
        brake: isDown('Space'),
      };
    updateCar(activeCar, input, dt, world);
  }

  // Health creeps back once the player has gone a while without taking a hit.
  if (health > 0 && health < START_HEALTH && elapsed - lastDamageAt > HEALTH.regenDelay) {
    health = Math.min(START_HEALTH, health + HEALTH.regenRate * dt);
  }

  // HUD: vitals, the heat as filled and empty stars, and a hint that follows context.
  healthEl.style.width = `${health}%`;
  healthEl.style.background = health < 30 ? '#e5534b' : '';
  moneyEl.textContent = `$${money}`;
  wantedEl.textContent = wanted.level > 0
    ? '★'.repeat(wanted.level) + '☆'.repeat(5 - wanted.level)
    : '';
  bustedWrap.style.display = bustedMeter > 0.02 ? 'block' : 'none';
  bustedFill.style.width = `${bustedMeter * 100}%`;

  // The job on the table, with its clock when it has one.
  const objective = missions.objectiveText || taxi.hudText();
  if (objective) {
    const t = missions.timerLeft;
    objectiveEl.textContent = t != null
      ? `${objective} — ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
      : objective;
    objectiveEl.style.display = 'block';
  } else {
    objectiveEl.style.display = 'none';
    objectiveEl.textContent = '';
  }
  stashEl.textContent = `Stash ${stashes.count}/${stashes.total}`;
  weaponEl.textContent = weapons.hudText();
  crossEl.style.display = weapons.weapon === 'pistol' && mode === 'foot' ? 'block' : 'none';

  // Race clock (or the 3-2-1-GO), and the district standing where the player stands.
  const raceText = races.hudText();
  raceEl.textContent = raceText;
  raceEl.style.display = raceText ? 'block' : 'none';
  const here = focus().pos;
  const hereDistrict = districtAt(here.x, here.z);
  districtEl.textContent = standing.hudText(here.x, here.z);
  standFillEl.style.width = `${standing.value(hereDistrict.id)}%`;

  const wh = mode === 'foot' && weapons.hint(player.group.position);
  if (wh) hintEl.textContent = wh;
  else if (!missions.activeName && missions.nearStart(focus().pos)) hintEl.textContent = 'Step in — Marisol has work for you';
  else if (mode === 'car' && taxi.nearWaiting(focus().pos)) hintEl.textContent = 'T — pick up a passenger';
  else if (mode === 'car' && !races.activeName && races.nearStart(focus().pos)) {
    const race = races.nearStart(focus().pos);
    hintEl.textContent = `E — start ${race.name} ($${race.reward})`;
  } else if (mode === 'car') hintEl.textContent = 'F — exit car · Space — handbrake';
  else if (nearestCar(3.5)) hintEl.textContent = 'F — enter car · J — punch';
  else if (pedestrians.some((ped) => Math.hypot(
    ped.group.position.x - player.group.position.x,
    ped.group.position.z - player.group.position.z,
  ) < 5)) hintEl.textContent = 'J — punch';
  else hintEl.textContent = '';
}

function updateCamera(dt) {
  if (state === 'title') {
    // A slow orbit above the harbour city behind the title.
    const angle = elapsed * 0.05;
    camera.position.set(Math.sin(angle) * 125, 58, Math.cos(angle) * 125 + 10);
    camera.lookAt(0, 0, 16);
    return;
  }
  const { pos, heading } = focus();
  if (mode === 'car' && elapsed - lastDragAt > CAMERA.realignDelay) {
    camYaw = turnToward(camYaw, heading + Math.PI, dt * 1.6);
  }
  const targetDist = mode === 'car' ? CAMERA.carDistance : CAMERA.footDistance;
  if (!dragging && Math.abs(camDist - targetDist) > 0.01 && elapsed - lastDragAt > CAMERA.realignDelay) {
    camDist += (targetDist - camDist) * Math.min(1, dt * 2);
  }
  const flat = Math.cos(camPitch);
  const desired = {
    x: pos.x + Math.sin(camYaw) * flat * camDist,
    y: pos.y + 1.7 + Math.sin(camPitch) * camDist,
    z: pos.z + Math.cos(camYaw) * flat * camDist,
  };
  const blend = 1 - Math.exp(-dt * 6);
  camera.position.x += (desired.x - camera.position.x) * blend;
  camera.position.y += (desired.y - camera.position.y) * blend;
  camera.position.z += (desired.z - camera.position.z) * blend;
  camera.lookAt(pos.x, pos.y + 1.6, pos.z);
}

// --- Minimap: the whole city on a 180x180 canvas, north (-Z) up. ---
const MAP = { minX: -210, minZ: -190, size: 420 };
function mapPoint(x, z) {
  return [((x - MAP.minX) / MAP.size) * 180, ((z - MAP.minZ) / MAP.size) * 180];
}

function drawMinimap() {
  const g = mapCtx;
  g.fillStyle = '#232a35';
  g.fillRect(0, 0, 180, 180);

  // Water along the bottom, then the quay strip above it.
  const [, waterY] = mapPoint(0, CITY.waterStart);
  g.fillStyle = '#16456b';
  g.fillRect(0, waterY, 180, 180 - waterY);
  const [, quayY] = mapPoint(0, CITY.half);
  g.fillStyle = '#4a5058';
  g.fillRect(0, quayY, 180, waterY - quayY);

  // The district the player stands in, tinted faintly so the map reads by area.
  const [qx] = mapPoint(-36, 0);
  const [mx] = mapPoint(36, 0);
  const [, qy] = mapPoint(0, 108);
  const d = districtAt(focus().pos.x, focus().pos.z);
  g.fillStyle = 'rgba(53, 224, 255, 0.09)';
  if (d.id === 'the-quay') g.fillRect(0, qy, 180, 180 - qy);
  else if (d.id === 'old-town') g.fillRect(0, 0, qx, qy);
  else if (d.id === 'marina') g.fillRect(mx, 0, 180 - mx, qy);
  else g.fillRect(qx, 0, mx - qx, qy);

  // Roads as light lines on both axes.
  g.strokeStyle = '#79828f';
  g.lineWidth = Math.max(2, (CITY.roadWidth / MAP.size) * 180);
  g.beginPath();
  for (const c of world.roadLines) {
    const [px] = mapPoint(c, 0);
    g.moveTo(px, 0);
    g.lineTo(px, 180);
    const [, py] = mapPoint(0, c);
    g.moveTo(0, py);
    g.lineTo(180, py);
  }
  g.stroke();

  // Parked cars as amber dots.
  g.fillStyle = '#ffb347';
  for (const car of cars) {
    const [px, py] = mapPoint(car.group.position.x, car.group.position.z);
    g.fillRect(px - 1.5, py - 1.5, 3, 3);
  }

  // Traffic cars as smaller grey dots, pedestrians as tiny faint ones.
  g.fillStyle = '#9aa3ad';
  for (const car of trafficCars) {
    const [px, py] = mapPoint(car.group.position.x, car.group.position.z);
    g.fillRect(px - 1.25, py - 1.25, 2.5, 2.5);
  }
  g.fillStyle = 'rgba(205, 215, 225, 0.5)';
  for (const ped of pedestrians) {
    const [px, py] = mapPoint(ped.group.position.x, ped.group.position.z);
    g.fillRect(px - 0.75, py - 0.75, 1.5, 1.5);
  }

  // Police units as blue dots, big enough to plan an escape around.
  g.fillStyle = '#3f8cff';
  for (const unit of police.cars) {
    const [px, py] = mapPoint(unit.group.position.x, unit.group.position.z);
    g.fillRect(px - 1.5, py - 1.5, 3, 3);
  }

  // The job: Marisol's marker, or wherever the current work points, in gold.
  for (const blip of missions.mapBlips()) {
    const [bx, by] = mapPoint(blip.x, blip.z);
    g.beginPath();
    g.arc(bx, by, 3.1, 0, Math.PI * 2);
    g.fillStyle = '#ffd166';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(10, 10, 10, 0.75)';
    g.stroke();
  }

  // Street races: cyan dots at the start rings, a ring around the next checkpoint.
  for (const blip of races.mapBlips()) {
    const [bx, by] = mapPoint(blip.x, blip.z);
    g.beginPath();
    g.arc(bx, by, blip.kind === 'checkpoint' ? 5 : 3, 0, Math.PI * 2);
    g.fillStyle = blip.kind === 'checkpoint' ? 'rgba(53, 224, 255, 0.35)' : '#35e0ff';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = '#35e0ff';
    g.stroke();
  }

  // Taxi: an amber dot for the waiting passenger, a ring for the drop-off.
  for (const blip of taxi.mapBlips()) {
    const [bx, by] = mapPoint(blip.x, blip.z);
    g.beginPath();
    g.arc(bx, by, blip.kind === 'taxiDest' ? 5 : 3, 0, Math.PI * 2);
    g.fillStyle = blip.kind === 'taxiDest' ? 'rgba(242, 201, 76, 0.35)' : '#f2c94c';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = '#f2c94c';
    g.stroke();
  }

  // Harbour stashes still out there, as small green dots.
  g.fillStyle = '#7dff8a';
  for (const blip of stashes.mapBlips()) {
    const [bx, by] = mapPoint(blip.x, blip.z);
    g.fillRect(bx - 1.25, by - 1.25, 2.5, 2.5);
  }

  // The player (or the driven car) as a white arrow rotated by facing.
  const { pos, heading } = focus();
  const [px, py] = mapPoint(pos.x, pos.z);
  g.save();
  g.translate(px, py);
  g.rotate(Math.atan2(Math.cos(heading), Math.sin(heading)));
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(6, 0);
  g.lineTo(-4.5, -3.6);
  g.lineTo(-4.5, 3.6);
  g.closePath();
  g.fill();
  g.restore();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Shot staging: ?shot=start keeps the title over the orbit; ?shot=play drops
// straight into the game beside the first parked car.
if (shot === 'play') {
  startGame();
  camYaw = firstCar.heading + Math.PI;
  camPitch = 0.3;
  camera.position.set(
    player.group.position.x + Math.sin(camYaw) * CAMERA.footDistance,
    4.2,
    player.group.position.z + Math.cos(camYaw) * CAMERA.footDistance,
  );
} else {
  announce('Neon Harbor: Port Azura. Press Start to explore the city.');
}

// --- The day drifting by: late afternoon melts into dusk and back over six minutes. ---
const SKY_DAY = new THREE.Color(0x3b4a6b);
const SKY_DUSK = new THREE.Color(0x252040);
const SUN_DAY = new THREE.Color(0xffb36b);
const SUN_DUSK = new THREE.Color(0xff8033);
const LAMP_DAY = new THREE.Color(0x8a6f45);
const LAMP_DUSK = new THREE.Color(0xffca7a);
const skyNow = new THREE.Color();

function updateDayCycle() {
  const phase = (elapsed % DAY.cycleSeconds) / DAY.cycleSeconds;
  const k = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); // 0 afternoon → 1 dusk → 0 again
  skyNow.copy(SKY_DAY).lerp(SKY_DUSK, k);
  scene.background.copy(skyNow);
  scene.fog.color.copy(skyNow);
  world.sun.color.copy(SUN_DAY).lerp(SUN_DUSK, k);
  world.sun.intensity = 1.0 - 0.45 * k;
  world.sun.position.set(-140 + 50 * k, 110 - 68 * k, -60);
  world.hemi.intensity = 0.55 - 0.23 * k;
  world.lampMaterial.color.copy(LAMP_DAY).lerp(LAMP_DUSK, k);
}

// --- Mission bookkeeping: the module reports, main.js pays, punishes, and plays. ---
let lastCardSeq = 0;
let cardTimer = null;

function showMissionCard() {
  const card = missions.card;
  if (!card) return;
  mcardTitleEl.textContent = card.title;
  mcardLineEl.textContent = card.line;
  missioncardEl.classList.add('show');
  if (cardTimer) clearTimeout(cardTimer);
  cardTimer = setTimeout(() => missioncardEl.classList.remove('show'), 6000);
}

function drainMissionEvents() {
  for (const event of missions.events) {
    if (event.type === 'complete') {
      money += event.payout;
      // The job ends where the player stands: that district remembers the work.
      standing.addStanding(districtAt(focus().pos.x, focus().pos.z).id, 8);
      audio.jingle();
      saveNow();
      announce(`${event.name} complete. +$${event.payout}.`);
    } else if (event.type === 'steal') {
      // Marisol's repossession is still, legally speaking, a theft: one star.
      setWanted(wanted, Math.min(WANTED.maxStars, wanted.level + 1));
    } else if (event.type === 'setWanted') {
      setWanted(wanted, event.level);
    } else if (event.type === 'pickup' || event.type === 'start') {
      audio.chime();
    } else if (event.type === 'fail') {
      audio.fail();
      announce(`${event.name}: out of time. The job waits at the harbour marker.`);
    }
  }
  missions.events.length = 0;
}

/** Race bookkeeping: main.js pays the win, credits the district, and saves. */
function drainRaceEvents() {
  for (const event of races.events) {
    if (event.type === 'win') {
      money += event.payout;
      standing.addStanding(districtAt(event.district.x, event.district.z).id, 6);
      audio.jingle();
      saveNow();
      const t = event.time.toFixed(1);
      announce(`${event.name} won in ${t}s — +$${event.payout}${event.isBest ? ' (best time!)' : ''}.`);
    } else if (event.type === 'start') {
      announce(`${event.name}: 3-2-1-GO — chase the cyan checkpoints.`);
    } else if (event.type === 'checkpoint') {
      audio.chime();
    } else if (event.type === 'cancel') {
      announce(`${event.name} abandoned.`);
    }
  }
  races.events.length = 0;
}

/** Taxi bookkeeping: main.js pays the fare and saves. */
function drainTaxiEvents() {
  for (const event of taxi.events) {
    if (event.type === 'fare') {
      money += event.payout;
      audio.jingle();
      saveNow();
      announce(`Fare complete. +$${event.payout}.`);
    } else if (event.type === 'pickup') {
      audio.chime();
      announce('Passenger aboard — get them there before the clock runs out.');
    } else if (event.type === 'timeout') {
      announce('Too slow — the passenger got out and flagged another cab.');
    } else if (event.type === 'cancel') {
      announce('Fare abandoned.');
    }
  }
  taxi.events.length = 0;
}

/** Stash bookkeeping: +$25 and +1 standing per stash; all ten pay a $250 bonus. */
function drainStashEvents() {
  for (const event of stashes.events) {
    money += event.payout;
    standing.addStanding(event.district, 1);
    audio.chime();
    saveNow();
    if (stashes.count >= stashes.total) {
      money += 250;
      announce(`All ${stashes.total} harbour stashes found! +$${event.payout} + $250 bonus.`);
    } else {
      announce(`Harbour stash found (${stashes.count}/${stashes.total}). +$${event.payout}.`);
    }
  }
  stashes.events.length = 0;
}

/** Weapon/shop bookkeeping: main.js pays, heals, and saves. */
function drainWeaponEvents() {
  for (const e of weapons.events) {
    if (e.type === 'buyAmmo') { money -= 30; weapons.ammo += 12; audio.chime(); saveNow(); announce('Ammo +12.'); }
    else if (e.type === 'buyHealth') { money -= 50; health = Math.min(START_HEALTH, health + 50); audio.chime(); saveNow(); announce('Health +50.'); }
    else if (e.type === 'deny') announce('Not enough cash.');
    else if (e.type === 'pickup') { audio.chime(); announce(e.kind === 'pistol' ? 'Pistol +24 ammo.' : 'Bat picked up.'); }
    else if (e.type === 'empty') announce('Out of ammo — visit a $ shop.');
    else announce('Nothing to buy.');
  }
  weapons.events.length = 0;
}

function togglePause() {
  paused = !paused;
  pausedEl.classList.toggle('hidden', !paused);
  announce(paused ? 'Paused.' : 'Playing.');
}

// A debug and test hook.
window.__game = {
  get state() { return state; },
  get mode() { return mode; },
  get wanted() { return wanted.level; },
  setWanted(level) { setWanted(wanted, level); },
  get policeCount() { return police.cars.length; },
  get health() { return health; },
  get money() { return money; },
  get bustedMeter() { return bustedMeter; },
  get mission() {
    return {
      active: missions.activeName,
      progress: missions.progress,
      storyDone: missions.storyDone,
      objective: missions.objectiveText,
    };
  },
  get races() {
    return { active: races.activeName, best: races.best, wins: races.wins };
  },
  get taxi() {
    return {
      active: taxi.active, dest: taxi.dest, waitingSpot: taxi.waitingSpot,
      fares: taxi.fares, earned: taxi.earned,
    };
  },
  get stashes() {
    return { found: stashes.found, count: stashes.count, spots: stashes.spots };
  },
  get weapons() { return weapons; },
  get peds() { return pedestrians.map((p) => ({ x: p.group.position.x, z: p.group.position.z, fleeT: p.fleeT })); },
  get playerPos() { return player.group.position; },
  get policePos() { return police.cars.map((c) => c.group.position); },
  get camYaw() { return camYaw; },
  setHealth(v) { health = Math.max(0, Math.min(START_HEALTH, v)); },
  get standing() { return standing.serialize(); },
  get raceDefs() { return races.defs; },
  get paused() { return paused; },
  get hasSave() { return !!loadSave(); },
  get marisol() { return MARISOL; },
  get carPositions() {
    return allCars.map((car) => ({ x: car.group.position.x, z: car.group.position.z }));
  },
  saveNow,
  teleport(x, z, heading) {
    player.group.position.set(x, 0, z);
    if (heading != null) { player.heading = heading; player.group.rotation.y = heading; }
    if (activeCar) activeCar.group.position.set(x, 0, z);
  },
  start: startGame,
};

let last = performance.now();
let painted = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  // Pause and mute are read straight off the press queue, before anything consumes it.
  if (state === 'playing' && (wasPressed('Escape') || wasPressed('KeyP'))) togglePause();
  if (wasPressed('KeyM')) announce(audio.toggleMute() ? 'Sound muted. M to unmute.' : 'Sound on.');
  if (!paused) elapsed += dt;
  if (state === 'playing' && !paused) updatePlaying(dt);
  // Traffic and pedestrians live in both states: the city stays alive behind the
  // title screen. Police units join the shared car list so traffic gives them room.
  const lifeCtx = {
    world,
    cars: [...allCars, ...police.cars],
    pedestrians,
    playerCar: activeCar,
    playerPos: mode === 'foot' ? player.group.position : null,
    now: elapsed,
    events: [],
  };
  if (!paused) {
    updateTraffic(trafficCars, dt, lifeCtx);
    updatePedestrians(pedestrians, dt, lifeCtx);
  }
  if (state === 'playing' && !paused) {
    // A pedestrian knocked down by the player's own car is a crime — the street saw it.
    for (const event of lifeCtx.events) {
      if (event.type === 'pedHit' && event.byPlayer) {
        reportCrime(wanted, 'hitPed', elapsed);
        if (activeCar) activeCar.speed *= 0.7;
      }
    }
    const f = focus();
    police.update(dt, {
      world,
      cars: lifeCtx.cars,
      pedestrians,
      playerPos: f.pos,
      playerInCar: mode === 'car',
      playerCar: activeCar,
      viewDir: { x: -Math.sin(camYaw), z: -Math.cos(camYaw) },
      now: elapsed,
      wanted: wanted.level,
    });
    // The heat fades only while no unit can actually see the player.
    const seen = police.cars.some((unit) => {
      const p = unit.group.position;
      return Math.hypot(p.x - f.pos.x, p.z - f.pos.z) < POLICE.sightRange
        && hasLineOfSight(p, f.pos, world.colliders);
    });
    updateWanted(wanted, dt, seen);
    updateConsequences(dt);
    // Marisol's clock only ticks while the run does: title, end cards, and pause freeze it.
    missions.update(dt, {
      pos: f.pos,
      mode,
      car: activeCar,
      now: elapsed,
      seen,
      registerCar: (car) => { allCars.push(car); },
    });
    drainMissionEvents();
    races.update(dt, { pos: f.pos, inCar: mode === 'car' });
    drainRaceEvents();
    taxi.update(dt, { pos: f.pos, inCar: mode === 'car' });
    drainTaxiEvents();
    stashes.update(dt, { pos: f.pos });
    drainStashEvents();
    drainWeaponEvents();
    saveTimer += dt;
    if (saveTimer >= 15) {
      saveTimer = 0;
      saveNow();
    }
  }
  if (missions.cardSeq !== lastCardSeq) {
    lastCardSeq = missions.cardSeq;
    showMissionCard();
  }
  updateDayCycle();
  audio.update({
    driving: state === 'playing' && mode === 'car' && !paused,
    speedRatio: activeCar ? Math.abs(activeCar.speed) / CAR.maxSpeed : 0,
    pursued: state === 'playing' && wanted.level > 0 && police.cars.length > 0,
  });
  updateCamera(dt);
  drawMinimap();
  renderer.render(scene, camera);
  endFrame();
  painted += 1;
  if (shot && painted >= 3) window.__shotReady = true;
}
requestAnimationFrame(frame);

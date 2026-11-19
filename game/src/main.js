// Neon Harbor: Port Azura — boot, the game loop, and everything that ties the pieces
// together: the title/playing state machine, the third-person orbit camera, entering
// and leaving cars, the HUD, and the minimap.
//
// ?seed=N fixes the city layout (default 1). ?shot=start stages the title screen over a
// slow orbit of the city; ?shot=play starts in-game beside a parked car. Both set
// window.__shotReady once the staged frame has painted, like the kit starter did.

import { CAMERA, CITY, START_HEALTH, START_MONEY } from './config.js';
import { createRandom } from './random.js';
import { buildWorld, circleHits } from './world.js';
import { spawnParkedCars, updateCar } from './cars.js';
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
const hintEl = document.getElementById('hint');
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

// The player starts beside the first parked car, on the road side of it: shifted from
// the car toward its road's centre line, so neither the player nor the opening camera
// starts inside a building (the blocks begin barely a metre past the kerb).
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

let state = 'title'; // 'title' | 'playing'
let mode = 'foot'; // 'foot' | 'car'
let activeCar = null;
let health = START_HEALTH;
let money = START_MONEY;

let camYaw = firstCar.heading + Math.PI;
let camPitch = 0.34;
let camDist = CAMERA.footDistance;
let lastDragAt = -10;
let elapsed = 0;

// --- Camera orbit input: drag to orbit, wheel to zoom. ---
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true;
  renderer.domElement.setPointerCapture(event.pointerId);
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

function startGame() {
  state = 'playing';
  titleEl.classList.add('hidden');
  announce('Exploring Port Azura on foot. F enters the nearest car.');
}

document.getElementById('start').addEventListener('click', startGame);

function nearestCar(maxDist) {
  const pos = player.group.position;
  let best = null;
  let bestDist = maxDist;
  for (const car of cars) {
    const d = Math.hypot(car.group.position.x - pos.x, car.group.position.z - pos.z);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

function enterCar(car) {
  activeCar = car;
  mode = 'car';
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

function updatePlaying(dt) {
  if (wasPressed('KeyF')) {
    if (mode === 'foot') {
      const car = nearestCar(3.5);
      if (car) enterCar(car);
    } else {
      exitCar();
    }
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
  } else if (activeCar) {
    const input = {
      throttle: (isDown('KeyW') || isDown('ArrowUp') ? 1 : 0) - (isDown('KeyS') || isDown('ArrowDown') ? 1 : 0),
      steer: (isDown('KeyD') || isDown('ArrowRight') ? 1 : 0) - (isDown('KeyA') || isDown('ArrowLeft') ? 1 : 0),
      brake: isDown('Space'),
    };
    updateCar(activeCar, input, dt, world);
  }

  // HUD: health and money change only in later sessions, but the hint follows context.
  healthEl.style.width = `${health}%`;
  moneyEl.textContent = `$${money}`;
  if (mode === 'car') hintEl.textContent = 'F — exit car · Space — handbrake';
  else if (nearestCar(3.5)) hintEl.textContent = 'F — enter car';
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

// --- Minimap: the whole city on a 180x180 canvas, north (-Z) up. The map spans
// x in [-210, 210] and z in [-190, 230] so the harbour water shows along the bottom. ---
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

  // The player (or the driven car) as a white arrow rotated by facing. On the map,
  // facing (sin h, cos h) in world XZ becomes the canvas direction (sin h, cos h).
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

// Shot staging: ?shot=start keeps the title over the orbit; ?shot=play drops straight
// into the game beside the first parked car, camera framed on the pair of them.
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

let last = performance.now();
let painted = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  if (state === 'playing') updatePlaying(dt);
  updateCamera(dt);
  drawMinimap();
  renderer.render(scene, camera);
  endFrame();
  painted += 1;
  if (shot && painted >= 3) window.__shotReady = true;
}
requestAnimationFrame(frame);

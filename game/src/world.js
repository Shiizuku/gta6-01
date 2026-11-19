// Port Azura itself: the dusk-lit grid city, its harbour, and the collision helpers the
// player and the cars share. buildWorld fills the THREE scene and returns everything the
// rest of the game needs to know about the place: building AABBs to collide with, the
// road grid (for parking cars and drawing the minimap), and the walkable bounds.
//
// Layout (metres, origin at the city centre): road lines run at (k - 4) * pitch for
// k = 0..8 on both axes, city blocks sit between them, the ground slab spans ±half, the
// quay runs along the +Z edge from half to quayEnd, and open water lies beyond that.

import { CITY } from './config.js';

const SKY = 0x3b4a6b;
const PALETTE = ['#6b5b73', '#54687f', '#7a6a58', '#4f6157', '#75655a', '#5d5470', '#71624f', '#4c5a6e'];

/** The X (and Z) coordinate of each road centre line, west to east. */
export function roadLines() {
  const lines = [];
  for (let k = 0; k <= CITY.blocks; k += 1) lines.push((k - CITY.blocks / 2) * CITY.pitch);
  return lines;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** True when a circle at pos (an {x, z} point) overlaps any building AABB. */
export function circleHits(pos, radius, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    const nearX = clamp(pos.x, box.minX, box.maxX);
    const nearZ = clamp(pos.z, box.minZ, box.maxZ);
    const dx = pos.x - nearX;
    const dz = pos.z - nearZ;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

/**
 * Move a circle by (dx, dz), one axis at a time so it slides along walls, then clamp it
 * inside the walkable bounds. Returns true when a building blocked either axis.
 */
export function moveWithCollision(pos, radius, dx, dz, colliders, bounds) {
  let hit = false;
  pos.x += dx;
  if (circleHits(pos, radius, colliders)) {
    pos.x -= dx;
    hit = true;
  }
  pos.z += dz;
  if (circleHits(pos, radius, colliders)) {
    pos.z -= dz;
    hit = true;
  }
  pos.x = clamp(pos.x, bounds.minX, bounds.maxX);
  pos.z = clamp(pos.z, bounds.minZ, bounds.maxZ);
  return hit;
}

/** A building facade: a canvas of window rows, some windows lit warm against the dusk. */
function makeFacadeTexture(rng, base) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 192;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 96, 192);
  g.fillStyle = 'rgba(0, 0, 0, 0.18)';
  g.fillRect(0, 0, 96, 10);
  const cols = 6;
  const rows = 14;
  const cellW = 96 / cols;
  const cellH = 192 / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (rng() < 0.42) {
        g.fillStyle = `rgba(255, 205, 130, ${(0.65 + rng() * 0.35).toFixed(2)})`;
      } else {
        g.fillStyle = 'rgba(14, 20, 34, 0.92)';
      }
      g.fillRect(col * cellW + 3, row * cellH + 4, cellW - 6, cellH - 7);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

function makeRoadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#22252b';
  g.fillRect(0, 0, 64, 256);
  // Worn edges, then a dashed centre line along the length of the strip.
  g.fillStyle = 'rgba(255, 255, 255, 0.20)';
  g.fillRect(2, 0, 2, 256);
  g.fillRect(60, 0, 2, 256);
  g.fillStyle = 'rgba(242, 201, 76, 0.85)';
  g.fillRect(30, 18, 4, 92);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

export function buildWorld(scene, rng) {
  const colliders = [];
  const lines = roadLines();
  const span = CITY.half * 2;

  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 130, 460);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3f4a, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.0);
  sun.position.set(-140, 110, -60);
  scene.add(sun);

  // Base slab: the sidewalk-grey ground everything sits on.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshLambertMaterial({ color: 0x3a3f47 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Block pads: a slightly lighter, raised sidewalk square under each block.
  const padMaterial = new THREE.MeshLambertMaterial({ color: 0x484f59 });
  const padGeometry = new THREE.PlaneGeometry(CITY.blockSize + 6, CITY.blockSize + 6);
  for (let i = 0; i < CITY.blocks; i += 1) {
    for (let j = 0; j < CITY.blocks; j += 1) {
      const pad = new THREE.Mesh(padGeometry, padMaterial);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set((i - CITY.blocks / 2 + 0.5) * CITY.pitch, 0.03, (j - CITY.blocks / 2 + 0.5) * CITY.pitch);
      scene.add(pad);
    }
  }

  // Roads: dark strips along every grid line, in both directions.
  const roadTexture = makeRoadTexture();
  const roadMaterial = new THREE.MeshLambertMaterial({ map: roadTexture });
  for (const c of lines) {
    const alongX = new THREE.Mesh(new THREE.PlaneGeometry(span, CITY.roadWidth), roadMaterial);
    alongX.rotation.x = -Math.PI / 2;
    alongX.position.set(0, 0.06, c);
    scene.add(alongX);
    const alongZ = new THREE.Mesh(new THREE.PlaneGeometry(span, CITY.roadWidth), roadMaterial);
    alongZ.rotation.x = -Math.PI / 2;
    alongZ.rotation.z = Math.PI / 2;
    alongZ.position.set(c, 0.06, 0);
    scene.add(alongZ);
  }

  // Buildings: each block is split into four plots; most plots get one building, taller
  // toward the city centre. A unit box scaled per building, textured on its sides.
  const facades = PALETTE.map((base) => new THREE.MeshLambertMaterial({ map: makeFacadeTexture(rng, base) }));
  const roofMaterial = new THREE.MeshLambertMaterial({ color: 0x272b33 });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.translate(0, 0.5, 0);
  for (let i = 0; i < CITY.blocks; i += 1) {
    for (let j = 0; j < CITY.blocks; j += 1) {
      const centreX = (i - CITY.blocks / 2 + 0.5) * CITY.pitch;
      const centreZ = (j - CITY.blocks / 2 + 0.5) * CITY.pitch;
      const downtown = 1 - Math.min(1, Math.hypot(centreX, centreZ) / 190);
      for (const ox of [-6, 6]) {
        for (const oz of [-6, 6]) {
          if (rng() < 0.14) continue;
          const w = 8.5 + rng() * 1.6;
          const d = 8.5 + rng() * 1.6;
          const h = 8 + rng() * 16 + downtown * (10 + rng() * 22);
          const facade = facades[Math.floor(rng() * facades.length)];
          const mesh = new THREE.Mesh(boxGeometry, [facade, facade, roofMaterial, roofMaterial, facade, facade]);
          mesh.scale.set(w, h, d);
          mesh.position.set(centreX + ox, 0, centreZ + oz);
          scene.add(mesh);
          colliders.push({
            minX: centreX + ox - w / 2,
            maxX: centreX + ox + w / 2,
            minZ: centreZ + oz - d / 2,
            maxZ: centreZ + oz + d / 2,
          });
        }
      }
    }
  }

  // Street lamps at every other intersection: a slim pole and a warm glowing head.
  const poleGeometry = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6);
  poleGeometry.translate(0, 2.6, 0);
  const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x1d2126 });
  const headGeometry = new THREE.SphereGeometry(0.22, 8, 6);
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffca7a });
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = 0; j < lines.length; j += 1) {
      if ((i + j) % 2 !== 0) continue;
      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.set(lines[i] + 7, 0, lines[j] + 7);
      scene.add(pole);
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.set(lines[i] + 7, 5.25, lines[j] + 7);
      scene.add(head);
    }
  }

  // The harbour: a concrete quay strip, two low warehouses and stacked crates on it,
  // then open water to the horizon.
  const quay = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 160, CITY.quayEnd - CITY.half),
    new THREE.MeshLambertMaterial({ color: 0x50565f }),
  );
  quay.rotation.x = -Math.PI / 2;
  quay.position.set(0, 0.04, (CITY.half + CITY.quayEnd) / 2);
  scene.add(quay);

  const warehouseMaterial = new THREE.MeshLambertMaterial({ color: 0x5d5648 });
  for (const wx of [-64, 72]) {
    const shed = new THREE.Mesh(boxGeometry, warehouseMaterial);
    shed.scale.set(24, 7, 11);
    shed.position.set(wx, 0, 174);
    scene.add(shed);
    colliders.push({ minX: wx - 12, maxX: wx + 12, minZ: 174 - 5.5, maxZ: 174 + 5.5 });
  }
  const crateMaterial = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
  const crate2Material = new THREE.MeshLambertMaterial({ color: 0x5f7386 });
  for (let n = 0; n < 9; n += 1) {
    const size = 1.6 + rng() * 1.2;
    const crate = new THREE.Mesh(boxGeometry, n % 2 ? crateMaterial : crate2Material);
    crate.scale.set(size, size, size);
    crate.position.set(-140 + rng() * 280, 0, 180 + rng() * 7);
    crate.rotation.y = rng() * Math.PI;
    scene.add(crate);
  }

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 520),
    new THREE.MeshPhongMaterial({ color: 0x14425e, shininess: 90, specular: 0x99c4e0 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, CITY.waterStart + 260);
  scene.add(water);

  return {
    colliders,
    roadLines: lines,
    bounds: { minX: -158, maxX: 158, minZ: -158, maxZ: CITY.quayEnd - 3 },
    waterZ: CITY.waterStart,
  };
}

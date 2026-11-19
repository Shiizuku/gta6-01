// Weapons + shops: floating pickups (pistol +24 ammo, bat), mouse-fire with a
// camera raycast, melee reach per weapon, and $ kiosks selling ammo or health.
import { wasPressed } from './input.js';
import { reportCrime } from './wanted.js';

const PICKUPS = [['pistol', 0, 176], ['pistol', -72, 0], ['pistol', 108, 72], ['bat', 36, -108], ['bat', -108, 108], ['bat', 144, -36]];
const SHOPS = [[12, 176], [-36, 36], [108, -72]];
const MAX_AMMO = 48;
const D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const dollarTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd166'; g.font = '58px sans-serif'; g.fillText('$', 15, 48);
  return new THREE.CanvasTexture(c);
})();

export function createWeapons(scene) {
  const W = {
    weapon: 'fists', ammo: 0, hasPistol: false, hasBat: false, cool: 0, animT: 0, events: [], shoot, update,
    hint(p) { return SHOPS.some((s) => D(p.x, p.z, s[0], s[1]) < 4) ? 'E — shop: ammo $30 · health $50' : ''; },
    hudText() { return W.weapon === 'pistol' ? `Pistol · ${W.ammo}` : W.weapon === 'bat' ? 'Bat' : 'Fists'; },
  };
  const items = PICKUPS.map((p) => {
    const g = new THREE.Mesh(
      p[0] === 'pistol' ? new THREE.BoxGeometry(0.14, 0.24, 0.55) : new THREE.BoxGeometry(0.12, 0.12, 0.95),
      new THREE.MeshBasicMaterial({ color: p[0] === 'pistol' ? 0xffd166 : 0xd9a441 }));
    g.position.set(p[1], 1.1, p[2]); scene.add(g);
    return { k: p[0], x: p[1], z: p[2], taken: false, group: g };
  });
  for (const s of SHOPS) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2), new THREE.MeshLambertMaterial({ color: 0x2e6f5e }));
    b.position.y = 1.1;
    const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: dollarTex }));
    d.scale.set(2, 2, 1); d.position.y = 3.2;
    g.add(b, d); g.position.set(s[0], 0, s[1]); scene.add(g);
  }
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
  const tracer = new THREE.Line(tracerGeo, tracerMat);
  tracer.visible = false; tracer.frustumCulled = false; scene.add(tracer);
  let tracerT = 0;
  function topGroup(o, gs) {
    while (o && gs.indexOf(o) < 0) o = o.parent;
    return gs.indexOf(o);
  }
  function fireTracer(from, to) {
    const p = tracerGeo.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    tracerGeo.attributes.position.needsUpdate = true;
    tracer.visible = true; tracerMat.opacity = 0.9; tracerT = 0.09;
  }
  function shoot() {
    const ctx = W.ctx;
    if (W.weapon !== 'pistol' || W.cool > 0) return;
    if (W.ammo <= 0) { W.cool = 0.3; W.events.push({ type: 'empty' }); return; }
    W.cool = 0.28; W.ammo -= 1;
    ctx.audio.bang();
    const gs = [...ctx.pedestrians.map((p) => p.group), ...ctx.police.map((c) => c.group), ...ctx.cars.map((c) => c.group)];
    const rc = new THREE.Raycaster();
    rc.setFromCamera({ x: 0, y: 0 }, ctx.camera);
    const hits = rc.intersectObjects(gs, true);
    const far = new THREE.Vector3();
    rc.ray.at(60, far);
    fireTracer(ctx.camera.position, hits.length ? hits[0].point : far);
    if (!hits.length) return;
    const i = topGroup(hits[0].object, gs);
    const np = ctx.pedestrians.length;
    if (i < np && i >= 0) {
      const ped = ctx.pedestrians[i];
      ped.fleeT = 3; ped.fleeX = ctx.pos.x; ped.fleeZ = ctx.pos.z;
      reportCrime(ctx.wanted, 'shoot', ctx.now);
    } else if (i < np + ctx.police.length) {
      reportCrime(ctx.wanted, 'shoot', ctx.now);
    } else {
      ctx.audio.thud();
    }
  }
  function update(dt, ctx) {
    W.ctx = ctx;
    W.animT += dt; W.cool = Math.max(0, W.cool - dt);
    if (tracerT > 0) {
      tracerT -= dt;
      tracerMat.opacity = Math.max(0, tracerT / 0.09) * 0.9;
      if (tracerT <= 0) tracer.visible = false;
    }
    for (const it of items) {
      if (it.taken) continue;
      it.group.rotation.y = W.animT * 2;
      it.group.position.y = 1.1 + Math.sin(W.animT * 2) * 0.15;
      if (ctx.mode === 'foot' && D(ctx.pos.x, ctx.pos.z, it.x, it.z) < 2.2) {
        it.taken = true; it.group.visible = false;
        if (it.k === 'pistol') { W.hasPistol = true; W.ammo = Math.min(MAX_AMMO, W.ammo + 24); }
        else W.hasBat = true;
        W.weapon = it.k;
        W.events.push({ type: 'pickup', kind: it.k });
      }
    }
    if (wasPressed('Digit1') && W.hasPistol) W.weapon = 'pistol';
    if (wasPressed('Digit2') && W.hasBat) W.weapon = 'bat';
    if (wasPressed('KeyQ')) {
      const o = ['fists', ...(W.hasPistol ? ['pistol'] : []), ...(W.hasBat ? ['bat'] : [])];
      W.weapon = o[(o.indexOf(W.weapon) + 1) % o.length];
    }
    if (ctx.mode === 'foot') {
      for (const s of SHOPS) {
        if (D(ctx.pos.x, ctx.pos.z, s[0], s[1]) >= 4 || !wasPressed('KeyE')) continue;
        const buy = W.hasPistol && W.ammo < MAX_AMMO ? ['buyAmmo', 30] : ctx.health < 100 ? ['buyHealth', 50] : null;
        W.events.push(buy ? ctx.money >= buy[1] ? { type: buy[0], cost: buy[1] } : { type: 'deny', cost: buy[1] } : { type: 'full' });
      }
    }
  }
  return W;
}

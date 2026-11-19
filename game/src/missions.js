// Missions: Marisol Venn runs the harbour cranes, half the quay, and — if the talk on
// the docks is true — most of what moves through Port Azura after dark. Her gold
// marker burns on the quay; step into it and she has work. Five jobs tell her story:
// a first delivery, a borrowed car, a round of pickups, a run under heat, and one
// long night haul. Finish the five and the city is yours — the marker stays lit for
// anyone who wants the work again, at half the money. Nothing here fails hard: run
// out of time and the job simply waits at the marker for another try.
//
// The module owns the markers and the mission state machine. It never touches the
// player's wallet or the wanted level itself: it reports what happened through its
// events queue (steal, setWanted, pickup, complete with the payout, fail) and lets
// main.js apply the consequences and the sounds.

/** Where Marisol's marker burns: on the quay, between the two harbour sheds. */
export const MARISOL = { x: 16, z: 176 };

const GOLD = 0xffd166;
const START_RADIUS = 3.6;
const REARM_RADIUS = 6;

/** A tall, soft column of gold light with a ring at its foot: the universal "here". */
function makeBeam(radius, height, opacity) {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: GOLD, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  column.position.y = height / 2;
  group.add(column);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.4, radius, 28),
    new THREE.MeshBasicMaterial({
      color: GOLD, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);
  return group;
}

/** A bobbing gold cone that hangs over the one car in the city that matters. */
function makeCarPointer() {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.95, 2.0, 4),
    new THREE.MeshBasicMaterial({ color: GOLD }),
  );
  cone.rotation.x = Math.PI; // Point down at the roof.
  cone.visible = false;
  return cone;
}

/** The Night Haul van: a tall box body on car bones, in dockyard cream. */
function makeVan() {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: 0xb8b0a4 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x10151f });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x14161a });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.55, 5.3), paint);
  body.position.y = 1.12;
  group.add(body);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 0.08), glass);
  windshield.position.set(0, 1.52, 2.66);
  group.add(windshield);
  const wheelGeometry = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  for (const sx of [-0.88, 0.88]) {
    for (const sz of [-1.85, 1.85]) {
      const wheel = new THREE.Mesh(wheelGeometry, tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.38, sz);
      group.add(wheel);
    }
  }
  const lightGeometry = new THREE.BoxGeometry(0.34, 0.13, 0.06);
  const head = new THREE.Mesh(lightGeometry, new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
  head.position.set(-0.6, 0.72, 2.68);
  group.add(head);
  const head2 = head.clone();
  head2.position.x = 0.6;
  group.add(head2);
  return { group, heading: 0, speed: 0 };
}

const DEFS = [
  {
    id: 'first-run',
    name: 'First Run',
    payout: 150,
    time: 150,
    brief: 'Marisol: "A shipping manifest needs to reach the Halcyon depot, clear across town. Take any car you like — just don\'t keep them waiting."',
    outro: 'Marisol: "Clean and quick. The depot boss sends his thanks, and so do I."',
  },
  {
    id: 'hot-property',
    name: 'Hot Property',
    payout: 220,
    time: null,
    brief: 'Marisol: "See the car I\'ve marked? Its owner owes the harbour more than it\'s worth. Bring it to my garage — consider it a repossession."',
    outro: 'Marisol: "Tucked away safe. You have a talent for borrowing things, friend."',
  },
  {
    id: 'errand-boy',
    name: 'Errand Boy',
    payout: 180,
    time: null,
    brief: 'Marisol: "Three crates walked off my quay and turned up all over town. Pick them up — every last one — and bring yourself back to me."',
    outro: 'Marisol: "All three, accounted for. The quay provides, and so do you."',
  },
  {
    id: 'heat',
    name: 'Heat',
    payout: 260,
    time: null,
    brief: 'Marisol: "The police are already watching you — I made sure of it. Don\'t ask why. Just reach the old hideout in the north-east corner and sit tight."',
    outro: 'Marisol: "You move well under pressure. That was the interview. Welcome to the real work."',
  },
  {
    id: 'night-haul',
    name: 'Night Haul',
    payout: 400,
    time: 180,
    brief: 'Marisol: "My van is waiting at the east depot, full of cargo that does not exist on any manifest. Take it to the north gate. Whatever you do, don\'t open the back."',
    outro: 'Marisol: "Delivered, sealed, and never happened. You\'re harbour family now."',
  },
];

const DEPOT = { x: -108, z: -108 }; // M1: the Halcyon depot gate, across town.
const GARAGE = { x: -64, z: 165 }; // M2: in front of Marisol's harbour shed.
const CRATES = [ // M3: where the wandering crates turned up (all intersections).
  { x: -108, z: -36 },
  { x: 108, z: 72 },
  { x: -36, z: 108 },
];
const HIDEOUT = { x: 144, z: -144 }; // M4: the north-east corner.
const VAN_DEPOT = { x: 105.2, z: 96 }; // M5: the van waits on the east-side road.
const NORTH_GATE = { x: -144, z: -72 }; // M5: the far-side delivery point.

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function createMissions(scene, parkedCars) {
  const startMarker = makeBeam(START_RADIUS, 7, 0.3);
  startMarker.position.set(MARISOL.x, 0, MARISOL.z);
  scene.add(startMarker);

  const targetMarker = makeBeam(4.4, 11, 0.35);
  targetMarker.visible = false;
  scene.add(targetMarker);

  const pointer = makeCarPointer();
  scene.add(pointer);

  const crateGroup = new THREE.Group();
  scene.add(crateGroup);

  let progress = 0; // Story jobs finished, 0..DEFS.length.
  let storyDone = false;
  let replayCursor = 0;
  let active = null; // { def, stage, timeLeft, targetCar, pickups, replay }
  let armed = true; // The start marker only fires on a fresh step into it.
  let animT = 0;
  let objectiveText = '';
  let van = null;

  const events = [];
  let card = null;
  let cardSeq = 0;

  function showCard(title, line) {
    card = { title, line };
    cardSeq += 1;
  }

  function nextDef() {
    return storyDone ? DEFS[replayCursor] : DEFS[progress];
  }

  function pointTargetAt(pos) {
    targetMarker.position.set(pos.x, 0, pos.z);
    targetMarker.visible = true;
  }

  function clearStageProps() {
    targetMarker.visible = false;
    pointer.visible = false;
    while (crateGroup.children.length) crateGroup.remove(crateGroup.children[0]);
  }

  function startMission(ctx) {
    const def = nextDef();
    active = {
      def,
      stage: 0,
      replay: storyDone,
      timeLeft: def.time,
      targetCar: null,
      pickups: [],
    };
    armed = false;
    showCard(def.name, def.brief);
    events.push({ type: 'start', name: def.name });

    if (def.id === 'first-run') {
      pointTargetAt(DEPOT);
    } else if (def.id === 'hot-property') {
      // The marked car: whichever parked car is resting farthest from the harbour.
      let best = null;
      let bestDist = -1;
      for (const car of parkedCars) {
        const d = dist(car.group.position, MARISOL);
        if (d > bestDist) { bestDist = d; best = car; }
      }
      active.targetCar = best;
      pointer.visible = true;
    } else if (def.id === 'errand-boy') {
      active.pickups = CRATES.map((spot) => {
        const beam = makeBeam(1.7, 3.2, 0.4);
        beam.position.set(spot.x, 0, spot.z);
        crateGroup.add(beam);
        return { x: spot.x, z: spot.z, taken: false, beam };
      });
    } else if (def.id === 'heat') {
      events.push({ type: 'setWanted', level: 2 });
      pointTargetAt(HIDEOUT);
    } else if (def.id === 'night-haul') {
      if (!van) {
        van = makeVan();
        scene.add(van.group);
        ctx.registerCar(van);
      }
      // The van always starts the job waiting at the east depot, keys in.
      van.group.position.set(VAN_DEPOT.x, 0, VAN_DEPOT.z);
      van.heading = 0;
      van.speed = 0;
      van.group.rotation.y = 0;
      active.targetCar = van;
      pointer.visible = true;
      pointTargetAt(VAN_DEPOT);
    }
  }

  function endMission() {
    active = null;
    objectiveText = '';
    clearStageProps();
    armed = false; // Whoever just finished stands in or near the marker: re-arm on exit.
  }

  function completeMission() {
    const { def } = active;
    const payout = active.replay ? Math.floor(def.payout / 2) : def.payout;
    events.push({ type: 'complete', name: def.name, payout });
    const justFinishedStory = !storyDone && def.id === DEFS[DEFS.length - 1].id;
    if (!storyDone) {
      progress = Math.min(DEFS.length, progress + 1);
      if (progress >= DEFS.length) storyDone = true;
    } else {
      replayCursor = (replayCursor + 1) % DEFS.length;
    }
    endMission();
    if (justFinishedStory) {
      showCard('STORY COMPLETE', `Marisol: "That's the last of it. Port Azura is yours now — and the marker stays lit if you ever want the work again." (+$${payout})`);
    } else {
      showCard(`${def.name} — complete`, `${def.outro} (+$${payout})`);
    }
  }

  function failMission() {
    const { def } = active;
    events.push({ type: 'fail', name: def.name });
    endMission();
    showCard('OUT OF TIME', 'Marisol: "No harm done — the job will still be there. Head back to the gold marker when you\'re ready."');
  }

  /**
   * Advance the mission state by dt. ctx is { pos, mode, car, now, registerCar }:
   * where the player is (his car when driving), how he travels, the car he is in,
   * the game clock, and a hook that adds a newly spawned car to the city's car list.
   */
  function update(dt, ctx) {
    animT += dt;
    // The harbour marker breathes gently so it reads from down the quay.
    const pulse = 0.3 + Math.sin(animT * 2.4) * 0.08;
    startMarker.children[0].material.opacity = pulse;
    startMarker.visible = !active;

    if (pointer.visible && active && active.targetCar) {
      const p = active.targetCar.group.position;
      pointer.position.set(p.x, 3.4 + Math.sin(animT * 3.2) * 0.35, p.z);
    }

    if (!active) {
      objectiveText = '';
      if (!armed && dist(ctx.pos, MARISOL) > REARM_RADIUS) armed = true;
      if (armed && dist(ctx.pos, MARISOL) < START_RADIUS) startMission(ctx);
      return;
    }

    if (active.timeLeft != null) {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) {
        failMission();
        return;
      }
    }

    const { def } = active;
    if (def.id === 'first-run') {
      objectiveText = ctx.mode === 'car'
        ? 'Drive to the Halcyon depot, across town'
        : 'Take any car and drive to the Halcyon depot, across town';
      if (ctx.mode === 'car' && dist(ctx.pos, DEPOT) < 8) completeMission();
    } else if (def.id === 'hot-property') {
      if (active.stage === 0) {
        objectiveText = 'Steal the car Marisol marked — follow the gold pointer';
        if (ctx.car && ctx.car === active.targetCar) {
          events.push({ type: 'steal', name: def.name });
          active.stage = 1;
          pointer.visible = false;
          pointTargetAt(GARAGE);
        }
      } else {
        objectiveText = ctx.car === active.targetCar
          ? 'Deliver it to Marisol\'s garage at the harbour'
          : 'Get back in the marked car';
        if (ctx.car === active.targetCar && dist(ctx.car.group.position, GARAGE) < 8) {
          completeMission();
        }
      }
    } else if (def.id === 'errand-boy') {
      if (active.stage === 0) {
        let taken = 0;
        for (const pickup of active.pickups) {
          if (pickup.taken) { taken += 1; continue; }
          if (dist(ctx.pos, pickup) < 4.5) {
            pickup.taken = true;
            crateGroup.remove(pickup.beam);
            events.push({ type: 'pickup', name: def.name });
            taken += 1;
          }
        }
        objectiveText = `Collect Marisol's crates around town (${taken}/${active.pickups.length})`;
        if (taken >= active.pickups.length) {
          active.stage = 1;
          pointTargetAt(MARISOL);
        }
      } else {
        objectiveText = 'Return to Marisol at the harbour';
        if (dist(ctx.pos, MARISOL) < 4.5) completeMission();
      }
    } else if (def.id === 'heat') {
      objectiveText = 'Reach the hideout in the north-east corner — with the heat on you';
      if (dist(ctx.pos, HIDEOUT) < 8) {
        events.push({ type: 'setWanted', level: 0 });
        completeMission();
      }
    } else if (def.id === 'night-haul') {
      if (active.stage === 0) {
        objectiveText = 'Pick up Marisol\'s van at the east depot';
        if (ctx.car && ctx.car === van) {
          active.stage = 1;
          pointer.visible = false;
          pointTargetAt(NORTH_GATE);
        }
      } else {
        objectiveText = ctx.car === van
          ? 'Deliver the van to the north gate'
          : 'Get back in the van';
        if (ctx.car === van && dist(van.group.position, NORTH_GATE) < 9) completeMission();
      }
    }
  }

  /** Gold minimap blips: the current target(s), or Marisol's marker when idle. */
  function mapBlips() {
    if (!active) return [{ x: MARISOL.x, z: MARISOL.z }];
    const { def } = active;
    if (def.id === 'first-run') return [DEPOT];
    if (def.id === 'hot-property') {
      if (active.stage === 1) return [GARAGE];
      if (!active.targetCar) return [];
      return [{ x: active.targetCar.group.position.x, z: active.targetCar.group.position.z }];
    }
    if (def.id === 'errand-boy') {
      if (active.stage === 1) return [{ x: MARISOL.x, z: MARISOL.z }];
      return active.pickups.filter((p) => !p.taken).map((p) => ({ x: p.x, z: p.z }));
    }
    if (def.id === 'heat') return [HIDEOUT];
    if (def.id === 'night-haul') {
      return active.stage === 0
        ? [{ x: van.group.position.x, z: van.group.position.z }]
        : [NORTH_GATE];
    }
    return [];
  }

  /** Restore story progress from a save (0..5 jobs done). Replay state resets. */
  function setProgress(n) {
    progress = Math.max(0, Math.min(DEFS.length, Math.round(n) || 0));
    storyDone = progress >= DEFS.length;
    replayCursor = 0;
  }

  return {
    update,
    events,
    mapBlips,
    setProgress,
    nearStart(pos) { return dist(pos, MARISOL) < 8; },
    get card() { return card; },
    get cardSeq() { return cardSeq; },
    get objectiveText() { return objectiveText; },
    get timerLeft() { return active && active.timeLeft != null ? Math.max(0, active.timeLeft) : null; },
    get progress() { return progress; },
    get storyDone() { return storyDone; },
    get activeName() { return active ? active.def.name : null; },
  };
}

# Neon Harbor: Port Azura

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Shiizuku/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Shiizuku/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Entered in the make.fun **gta6-01** bounty — "Make GTA 6": https://make.fun/bounty/gta6-01

Port Azura is a dusk-lit harbour city that never quite sleeps, and Marisol Venn — who runs the cranes down at the quay — always has work for someone with a car, quick hands and no questions. **Neon Harbor: Port Azura** is an original open-world crime game that runs entirely in a desktop browser from static files: explore the city on foot or by car, run Marisol's eight-job story chain, and try to make money faster than your driving earns you stars — because the Port Azura police are patient, organised, and already on their way.

## Features

- **The city** — a three.js city of 8×8 blocks and roughly 220 procedurally placed buildings with lit dusk windows, street lamps, and a working harbour along one edge: quay, warehouses, crates and open water.
- **On foot and by car** — walk, sprint and fight on foot; press F to take any parked car, or borrow a traffic car that has stopped. Arcade driving with speed-scaled steering and a handbrake, plus a third-person camera you can orbit and zoom.
- **Weapons & shops** — pick up a pistol and a bat around the city: the pistol fires a raycast shot on mouse click and spends ammo, the bat (and bare fists) swing on click. Switch weapons with 1 / 2 / Q. Dollar-marked shops sell ammo ($30 for +12, max 48) and health ($50) — walk up on foot and press E.
- **Living streets** — AI traffic drives the road grid in lanes, turns at intersections, brakes for obstacles and resumes its rounds after you abandon its car; pedestrians stroll the sidewalks, cross at corners, and dodge or flee when things get loud.
- **Wanted system & police** — crime that is witnessed earns stars (0–5): theft, collisions, brawls. Police units spawn out of sight, navigate the grid to you, and box you in; stay out of their sight to cool the heat down. At 4 stars a police helicopter joins the chase, circling overhead with a searchlight tracking you, and flies off once the heat drops below 3. Get cornered on foot and you are **BUSTED** (−15% of your cash); wreck your health and you are **WASTED** (−10%).
- **Missions & story** — an eight-job chain for harbour fixer Marisol Venn, started at the gold marker on the quay: *First Run* ($150), *Hot Property* ($220), *Errand Boy* ($180), *Heat* ($260), *Night Haul* ($400), *Silent Partner* ($300), *Heat Wave* ($380) and *Port Heist* ($600). Finish the story and the chain replays at half pay.
- **Street races** — three checkpoint races with a 3-2-1-GO countdown, started with E at their cyan rings: *Harbour Sprint* ($150), *Downtown Loop* ($300) and *Marina Dash* ($500). Best times are saved, and winning pays more where the district respects you.
- **District standing** — four districts (Old Town, Downtown, The Quay, Marina) each track how the city sees you, from Stranger to Legend: missions pay +8 standing where they end, race wins +6, fares and stashes add their own. Reach Respected for +25% race winnings in that district, Legend for +50%.
- **Taxi fares** — pick up waiting passengers (T, in a car) and race their clock to the destination for a distance-and-time fare; a slow fare walks away.
- **Harbour stashes** — ten hidden stashes along the quay, $25 each and a $250 bonus for finding them all.
- **Saves** — progress autosaves to `localStorage` (money, health, story progress, where you left yourself and your car); the title screen offers **Continue** next to **New Game**.
- **Polish** — a six-minute day cycle that melts late afternoon into dusk and back, fully synthesized WebAudio sound (engine, siren, chimes, jingles — no audio files), a live minimap, and pause.

## Controls

| Input | Action |
| --- | --- |
| **W A S D** / arrow keys | Walk / drive |
| **Shift** | Sprint (on foot) |
| **Space** | Handbrake (in a car) |
| **F** | Enter / exit car |
| **E** | Start street race (in a car, at a race ring) / buy ammo or health (on foot, at a $ shop) |
| **T** | Accept taxi fare (in a car, near a passenger) |
| **1 / 2 / Q** | Switch weapon (pistol / bat / cycle weapons) |
| **J** or **mouse click** | Punch / swing bat / shoot pistol (depends on weapon) |
| **Mouse drag** | Orbit camera |
| **Mouse wheel** | Camera zoom |
| **M** | Mute / unmute |
| **P** or **Esc** | Pause |

## Run it locally

```sh
node serve.ts
```

then open <http://localhost:8080> in a desktop browser. That is all: there is no build step and nothing to install.

## Tech note

Plain static files under `game/` — `game/index.html` plus ES modules under `game/src/`. three.js (r128) is vendored at `game/vendor/three.min.js` and is the only external code; the game makes **no network requests at runtime** and works fully offline. `main.ts` is the hand-in program: it copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored `vendor/makefun-game.ts` library. The world is deterministic from `?seed=` (default 1); `?shot=start` and `?shot=play` stage the title and in-game views used for the screenshots.

MIT licensed — see `LICENSE`.

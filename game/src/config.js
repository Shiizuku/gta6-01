// Every tuning number for Neon Harbor: Port Azura in one place. Distances are metres,
// speeds are metres per second, angles are radians. The city is a square grid centred on
// the origin: roads run along the grid lines, city blocks sit between them, and the
// harbour (quay, then open water) lies along the +Z (southern) edge.

export const CITY = {
  /** City blocks along each axis. */
  blocks: 8,
  /** Centre-to-centre spacing of neighbouring road lines. */
  pitch: 36,
  /** Width of one city block (the buildable square between roads). */
  blockSize: 24,
  /** Width of one road, gutter to gutter. */
  roadWidth: 12,
  /** The ground slab reaches this far from the centre on every side. */
  half: 162,
  /** The quay (walkable concrete) runs from the ground edge to this Z. */
  quayEnd: 190,
  /** Open water starts at this Z and runs to the horizon. */
  waterStart: 190,
};

export const PLAYER = {
  /** Collision circle radius while on foot. */
  radius: 0.45,
  walkSpeed: 5.2,
  sprintSpeed: 8.8,
};

export const CAR = {
  /** Collision circle radius for a car (covers most of its body). */
  radius: 1.55,
  maxSpeed: 30,
  maxReverse: 9,
  accel: 15,
  brake: 30,
  /** How many parked cars the city spawns. */
  parkedCount: 12,
};

export const CAMERA = {
  footDistance: 7.5,
  carDistance: 11,
  minDistance: 4,
  maxDistance: 22,
  minPitch: 0.1,
  maxPitch: 1.15,
  /** Seconds without a mouse drag before the camera settles behind a driven car. */
  realignDelay: 2.5,
};

export const TRAFFIC = {
  /** How many self-driving cars keep the streets busy. */
  count: 12,
  /** Cruise speed range; each traffic car picks one speed inside it. */
  cruiseMin: 8,
  cruiseMax: 11,
  /** Lane offset from the road centre line (right-hand traffic). */
  laneOffset: 2.8,
  /** Speed a traffic car slows to while it is turning a corner. */
  turnSpeed: 4.6,
  /** Seconds after the player hands a traffic car back before it resumes its rounds. */
  resumeDelay: 3,
};

export const PED = {
  /** How many pedestrians walk the sidewalks. */
  count: 17,
  /** Collision circle radius on foot. */
  radius: 0.35,
  /** Sidewalk strolling speed range; each pedestrian picks one speed inside it. */
  walkMin: 1.15,
  walkMax: 1.7,
  /** Chance, on reaching a block corner, of crossing the road to the next block. */
  crossChance: 0.25,
};

export const WANTED = {
  /** The police never care more than this many stars' worth. */
  maxStars: 5,
  /** Seconds with no police line-of-sight on the player before one star fades. */
  decaySeconds: 20,
};

export const POLICE = {
  /** Most police cars on the street at once, however hot the chase gets. */
  maxActive: 4,
  /** Pursuit cruise speed: faster than traffic, slower than a fleeing player car. */
  cruise: 15.5,
  /** Speed a police car slows to while rounding a corner. */
  cornerSpeed: 6.5,
  /** Spawns land at least / at most this far from the player, in metres. */
  spawnMinDist: 55,
  spawnMaxDist: 120,
  /** Seconds between reinforcements rolling in. */
  spawnInterval: 0.8,
  /** A police car this close with a clear view counts as seeing the player. */
  sightRange: 45,
  /** Inside this distance, grid navigation gives way to a direct chase. */
  directRange: 22,
  /** A direct chase falls back to the road grid beyond this distance. */
  directExit: 34,
  /** An on-foot player with a police car inside this range is being cornered. */
  bustRange: 6,
  /** Seconds cornered before the player is BUSTED. */
  bustSeconds: 3,
};

export const HEALTH = {
  /** Seconds without taking damage before health starts recovering. */
  regenDelay: 8,
  /** Health points recovered per second once recovery starts. */
  regenRate: 7,
};

export const START_MONEY = 250;
export const START_HEALTH = 100;

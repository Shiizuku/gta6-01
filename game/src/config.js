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

export const START_MONEY = 250;
export const START_HEALTH = 100;

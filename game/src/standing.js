// District standing: how Port Azura thinks of the player, per district. Four
// districts split the city along its roads — The Quay along the harbour, Old Town
// west, Marina east, Downtown the centre. Standing runs 0..100 and is earned by
// finishing Marisol's jobs (+8, in the district the job ends in) and winning
// street races (+6, in the race's district); addStanding is the hook future
// systems (taxi fares, stashes) call with their own amounts.
//
// Levels: 0-24 Stranger, 25-49 Known, 50-79 Respected, 80+ Legend. The perks
// are real: Respected pays +25% on race winnings in that district, Legend +50%.

export const DISTRICTS = [
  { id: 'old-town', name: 'Old Town' },
  { id: 'downtown', name: 'Downtown' },
  { id: 'the-quay', name: 'The Quay' },
  { id: 'marina', name: 'Marina' },
];

/** Which district a point in the city belongs to. */
export function districtAt(x, z) {
  if (z >= 108) return DISTRICTS[2]; // The Quay: the harbour strip.
  if (x < -36) return DISTRICTS[0]; // Old Town: the west side.
  if (x >= 36) return DISTRICTS[3]; // Marina: the east side.
  return DISTRICTS[1]; // Downtown: the centre.
}

export function levelName(value) {
  if (value >= 80) return 'Legend';
  if (value >= 50) return 'Respected';
  if (value >= 25) return 'Known';
  return 'Stranger';
}

/** Race-payout multiplier for a district, from the standing object or a value. */
export function raceRewardMult(standing, pos) {
  const district = districtAt(pos.x, pos.z);
  const value = standing ? standing.value(district.id) : 0;
  if (value >= 80) return 1.5;
  if (value >= 50) return 1.25;
  return 1;
}

export function createStanding(saved) {
  const values = {};
  for (const d of DISTRICTS) values[d.id] = 0;
  if (saved && typeof saved === 'object') {
    for (const d of DISTRICTS) {
      if (Number.isFinite(saved[d.id])) {
        values[d.id] = Math.max(0, Math.min(100, Math.round(saved[d.id])));
      }
    }
  }

  return {
    /** Standing 0..100 in a district. */
    value(id) { return values[id] ?? 0; },
    /** Add standing in a district (clamped 0..100); the hook other systems use. */
    addStanding(id, n) {
      if (values[id] == null || !Number.isFinite(n)) return;
      values[id] = Math.max(0, Math.min(100, values[id] + n));
    },
    level(id) { return levelName(values[id] ?? 0); },
    /** Restore saved values; unknown or missing fields keep their defaults. */
    setValues(saved) {
      if (!saved || typeof saved !== 'object') return;
      for (const d of DISTRICTS) {
        if (Number.isFinite(saved[d.id])) {
          values[d.id] = Math.max(0, Math.min(100, Math.round(saved[d.id])));
        }
      }
    },
    /** One line for the HUD: district, level, and value where the player stands. */
    hudText(x, z) {
      const d = districtAt(x, z);
      const v = values[d.id];
      return `${d.name} · ${levelName(v)} ${v}`;
    },
    serialize() { return { ...values }; },
  };
}

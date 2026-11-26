import type { GraveyardEntity, Severity } from "./types.js";

/**
 * Penalty applied per entity severity level.
 * Severity 1 (minor) = 2 pts, severity 2 (moderate) = 5 pts, severity 3 (critical) = 10 pts.
 */
const PENALTY: Record<Severity, number> = { 1: 2, 2: 5, 3: 10 };

/**
 * Compute a repository health score from a list of graveyard entities.
 *
 * The score starts at 100 and each entity subtracts a penalty determined by
 * its severity. The result is clamped to [0, 100] and is always an integer.
 *
 * Score formula: `Math.max(0, Math.min(100, 100 - totalPenalty))`
 *
 * An empty entity list always returns 100.
 * No matter how many entities exist, the score never goes below 0.
 *
 * @param entities - The full list of detected graveyard entities.
 * @returns An integer in the range [0, 100].
 */
export function computeHealthScore(entities: GraveyardEntity[]): number {
  if (!entities || !Array.isArray(entities) || entities.length === 0) {
    return 100;
  }

  const totalPenalty = entities.reduce((sum, entity) => {
    // Guard against malformed objects in the array
    if (!entity || typeof entity !== "object") {
      return sum;
    }
    const penalty = PENALTY[entity.severity as Severity] ?? 0;
    return sum + penalty;
  }, 0);

  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeHealthScore } from "../../scanner/health.js";
import type { GraveyardEntity } from "../../scanner/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dummyEntity(severity: 1 | 2 | 3): GraveyardEntity {
  return {
    id: "dummy",
    type: "tombstone",
    title: "Dummy",
    ref: "dummy",
    evidence: [],
    severity,
    epitaph: "Dummy epitaph",
    remediation: "Dummy remediation",
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("computeHealthScore", () => {
  it("returns 100 for an empty array", () => {
    expect(computeHealthScore([])).toBe(100);
  });

  it("returns 98 for one severity-1 entity (penalty = 2)", () => {
    expect(computeHealthScore([dummyEntity(1)])).toBe(98);
  });

  it("returns 95 for one severity-2 entity (penalty = 5)", () => {
    expect(computeHealthScore([dummyEntity(2)])).toBe(95);
  });

  it("returns 90 for one severity-3 entity (penalty = 10)", () => {
    expect(computeHealthScore([dummyEntity(3)])).toBe(90);
  });

  it("returns 0 for 10 severity-3 entities (total penalty = 100)", () => {
    const entities = Array.from({ length: 10 }, () => dummyEntity(3));
    expect(computeHealthScore(entities)).toBe(0);
  });

  it("returns 0 for more than 100 penalty (clamped to 0)", () => {
    const entities = Array.from({ length: 15 }, () => dummyEntity(3));
    expect(computeHealthScore(entities)).toBe(0);
  });

  it("computes correctly for a mix of severities", () => {
    // 1 × severity-3 (10) + 2 × severity-2 (10) + 1 × severity-1 (2) = 22
    // 100 - 22 = 78
    const entities = [
      dummyEntity(3),
      dummyEntity(2),
      dummyEntity(2),
      dummyEntity(1),
    ];
    expect(computeHealthScore(entities)).toBe(78);
  });

  it("never returns a value above 100", () => {
    // Even with zero penalty, the score is 100
    expect(computeHealthScore([])).toBe(100);
  });

  it("never returns a value below 0", () => {
    const entities = Array.from({ length: 100 }, () => dummyEntity(3));
    expect(computeHealthScore(entities)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

describe("computeHealthScore — properties", () => {
  it("score is always in [0, 100]", () => {
    const entityArb: fc.Arbitrary<GraveyardEntity> = fc.record({
      id: fc.string(),
      type: fc.constantFrom(
        "tombstone" as const,
        "zombie" as const,
        "ghost" as const,
        "crypt" as const
      ),
      title: fc.string(),
      ref: fc.string(),
      evidence: fc.array(fc.record({ label: fc.string(), value: fc.string() })),
      severity: fc.constantFrom(1 as const, 2 as const, 3 as const),
      epitaph: fc.string(),
      remediation: fc.string(),
    });

    fc.assert(
      fc.property(fc.array(entityArb), (entities) => {
        const score = computeHealthScore(entities);
        return score >= 0 && score <= 100;
      })
    );
  });

  it("score is 100 for an empty array (always)", () => {
    fc.assert(
      fc.property(fc.constant([] as GraveyardEntity[]), (entities) => {
        return computeHealthScore(entities) === 100;
      })
    );
  });

  it("removing any entity from the list never lowers the score", () => {
    const entityArb: fc.Arbitrary<GraveyardEntity> = fc.record({
      id: fc.string(),
      type: fc.constantFrom(
        "tombstone" as const,
        "zombie" as const,
        "ghost" as const,
        "crypt" as const
      ),
      title: fc.string(),
      ref: fc.string(),
      evidence: fc.array(fc.record({ label: fc.string(), value: fc.string() })),
      severity: fc.constantFrom(1 as const, 2 as const, 3 as const),
      epitaph: fc.string(),
      remediation: fc.string(),
    });

    fc.assert(
      fc.property(
        fc.array(entityArb, { minLength: 1 }),
        fc.integer(),
        (entities, seed) => {
          const originalScore = computeHealthScore(entities);
          const idx = Math.abs(seed) % entities.length;
          const removed = entities.filter((_, i) => i !== idx);
          const newScore = computeHealthScore(removed);
          return newScore >= originalScore;
        }
      )
    );
  });

  it("adding a severity-1 entity reduces score by exactly 2 (unless already at 0)", () => {
    const entityArb: fc.Arbitrary<GraveyardEntity> = fc.record({
      id: fc.string(),
      type: fc.constantFrom(
        "tombstone" as const,
        "zombie" as const,
        "ghost" as const,
        "crypt" as const
      ),
      title: fc.string(),
      ref: fc.string(),
      evidence: fc.array(fc.record({ label: fc.string(), value: fc.string() })),
      severity: fc.constantFrom(1 as const, 2 as const, 3 as const),
      epitaph: fc.string(),
      remediation: fc.string(),
    });

    fc.assert(
      fc.property(fc.array(entityArb), (entities) => {
        const originalScore = computeHealthScore(entities);
        if (originalScore <= 2) {
          return true;
        }
        const withOne = [...entities, dummyEntity(1)];
        const newScore = computeHealthScore(withOne);
        return newScore === originalScore - 2;
      })
    );
  });

  it("never throws on malformed objects in the array", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant({}),
            fc.record({
              id: fc.string(),
              type: fc.constantFrom(
                "tombstone" as const,
                "zombie" as const,
                "ghost" as const,
                "crypt" as const
              ),
              title: fc.string(),
              ref: fc.string(),
              evidence: fc.array(
                fc.record({ label: fc.string(), value: fc.string() })
              ),
              severity: fc.constantFrom(1 as const, 2 as const, 3 as const),
              epitaph: fc.string(),
              remediation: fc.string(),
            })
          )
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (arr: any[]) => {
          expect(() => computeHealthScore(arr)).not.toThrow();
        }
      )
    );
  });
});

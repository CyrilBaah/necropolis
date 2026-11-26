import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectZombies } from "../../scanner/zombie.js";
import type { BranchInfo, PullRequestInfo } from "../../scanner/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2024-06-01T00:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function branch(
  name: string,
  daysInactive: number,
  isDefault = false
): BranchInfo {
  return { name, lastCommitDate: daysAgo(daysInactive), isDefault };
}

function pr(
  number: number,
  title: string,
  daysInactive: number,
  headRef: string
): PullRequestInfo {
  return {
    number,
    title,
    state: "open",
    lastActivityDate: daysAgo(daysInactive),
    headRef,
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("detectZombies", () => {
  it("returns [] for empty inputs", () => {
    expect(detectZombies([], [], NOW)).toEqual([]);
  });

  it("flags a branch inactive for 91 days", () => {
    const result = detectZombies([branch("feature/old", 91)], [], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("zombie");
    expect(result[0]!.ref).toBe("branch:feature/old");
  });

  it("does not flag a branch inactive for only 30 days", () => {
    const result = detectZombies([branch("feature/fresh", 30)], [], NOW);
    expect(result).toEqual([]);
  });

  it("does not flag the default branch", () => {
    const result = detectZombies([branch("main", 500, true)], [], NOW);
    expect(result).toEqual([]);
  });

  it("flags an open PR inactive for 90+ days", () => {
    const result = detectZombies([], [pr(42, "Old feature", 100, "feature/old")], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.ref).toBe("pr:42");
    expect(result[0]!.type).toBe("zombie");
  });

  it("does not flag a PR active within 90 days", () => {
    const result = detectZombies([], [pr(1, "Recent", 45, "feature/new")], NOW);
    expect(result).toEqual([]);
  });

  it("emits one entity when a zombie branch also has a zombie PR (the PR wins)", () => {
    const b = branch("feature/old", 200);
    const p = pr(7, "Old feature PR", 200, "feature/old");
    const result = detectZombies([b], [p], NOW);
    // Only the PR entity, not the branch
    expect(result).toHaveLength(1);
    expect(result[0]!.ref).toBe("pr:7");
  });

  it("emits a branch entity when the branch is zombie but its PR is fresh", () => {
    const b = branch("feature/old", 200);
    const p = pr(7, "Fresh PR", 10, "feature/old");
    const result = detectZombies([b], [p], NOW);
    // PR is fresh (not zombie), so the branch entity is emitted
    expect(result).toHaveLength(1);
    expect(result[0]!.ref).toBe("branch:feature/old");
  });

  it("assigns severity 1 for 90–179 days", () => {
    const result = detectZombies([branch("b", 90)], [], NOW);
    expect(result[0]!.severity).toBe(1);
  });

  it("assigns severity 2 for 180–364 days", () => {
    const result = detectZombies([branch("b", 180)], [], NOW);
    expect(result[0]!.severity).toBe(2);
  });

  it("assigns severity 3 for 365+ days", () => {
    const result = detectZombies([branch("b", 365)], [], NOW);
    expect(result[0]!.severity).toBe(3);
  });

  it("includes days inactive in evidence", () => {
    const result = detectZombies([branch("feature/old", 100)], [], NOW);
    const evidence = result[0]!.evidence;
    const daysEvidence = evidence.find((e) => e.label === "Days inactive");
    expect(daysEvidence).toBeDefined();
    expect(Number(daysEvidence!.value)).toBeGreaterThanOrEqual(100);
  });

  it("epitaph mentions the branch name and days", () => {
    const result = detectZombies([branch("feature/zombie", 91)], [], NOW);
    expect(result[0]!.epitaph).toContain("feature/zombie");
    expect(result[0]!.epitaph).toContain("91");
  });

  it("epitaph for PR mentions number and title", () => {
    const result = detectZombies(
      [],
      [pr(99, "My stale PR", 200, "stale-branch")],
      NOW
    );
    expect(result[0]!.epitaph).toContain("#99");
    expect(result[0]!.epitaph).toContain("My stale PR");
  });

  it("remediation for branch uses git push --delete", () => {
    const result = detectZombies([branch("feature/dead", 200)], [], NOW);
    expect(result[0]!.remediation).toContain("git push origin --delete");
    expect(result[0]!.remediation).toContain("feature/dead");
  });

  // --- Property-based ---

  it("property: never throws on empty inputs", () => {
    fc.assert(
      fc.property(fc.constant(NOW), (now) => {
        expect(() => detectZombies([], [], now)).not.toThrow();
      })
    );
  });

  it("property: never throws on arbitrary branch/PR arrays", () => {
    // Constrain dates to a sane range to avoid RangeError from toISOString()
    const safeDate = fc
      .date({ min: new Date("1970-01-01"), max: new Date("2100-01-01") })
      .map((d) => d.toISOString());

    const branchArb = fc.record({
      name: fc.string({ minLength: 1 }),
      lastCommitDate: fc.oneof(fc.constant(""), fc.constant("not-a-date"), safeDate),
      isDefault: fc.boolean(),
    });
    const prArb = fc.record({
      number: fc.integer({ min: 1 }),
      title: fc.string(),
      state: fc.constant("open" as const),
      lastActivityDate: fc.oneof(fc.constant(""), safeDate),
      headRef: fc.string({ minLength: 1 }),
    });
    fc.assert(
      fc.property(
        fc.array(branchArb),
        fc.array(prArb),
        fc.date({ min: new Date("1970-01-01"), max: new Date("2100-01-01") }),
        (branches, prs, now) => {
          expect(() => detectZombies(branches, prs, now)).not.toThrow();
        }
      )
    );
  });

  it("property: a branch active within 90 days is never a zombie", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 0, max: 89 }),
        (name, daysInactive) => {
          const b: BranchInfo = {
            name,
            lastCommitDate: daysAgo(daysInactive),
            isDefault: false,
          };
          const result = detectZombies([b], [], NOW);
          return result.length === 0;
        }
      )
    );
  });

  it("property: a zombie PR always suppresses its matching zombie branch", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-z-]+$/.test(s)),
        fc.integer({ min: 1, max: 9999 }),
        (branchName, prNumber) => {
          const b: BranchInfo = {
            name: branchName,
            lastCommitDate: daysAgo(200),
            isDefault: false,
          };
          const p: PullRequestInfo = {
            number: prNumber,
            title: "Some PR",
            state: "open",
            lastActivityDate: daysAgo(200),
            headRef: branchName,
          };
          const result = detectZombies([b], [p], NOW);
          // No entity should reference the branch directly
          return !result.some((e) => e.ref === `branch:${branchName}`);
        }
      )
    );
  });
});

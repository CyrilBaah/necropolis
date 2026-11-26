import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { entityId } from "../../scanner/id.js";

describe("entityId", () => {
  it("returns a 16-character hex string", () => {
    const id = entityId("tombstone", "src/foo.ts");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable — same inputs always produce the same id", () => {
    const a = entityId("tombstone", "src/foo.ts");
    const b = entityId("tombstone", "src/foo.ts");
    expect(a).toBe(b);
  });

  it("produces different ids for different types with the same ref", () => {
    expect(entityId("tombstone", "src/foo.ts")).not.toBe(
      entityId("ghost", "src/foo.ts")
    );
  });

  it("produces different ids for different refs with the same type", () => {
    expect(entityId("tombstone", "src/foo.ts")).not.toBe(
      entityId("tombstone", "src/bar.ts")
    );
  });

  // --- Property-based ---

  it("property: always returns a 16-character lowercase hex string", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (type, ref) => {
        const id = entityId(type, ref);
        return /^[0-9a-f]{16}$/.test(id);
      })
    );
  });

  it("property: is stable (idempotent)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (type, ref) => {
        return entityId(type, ref) === entityId(type, ref);
      })
    );
  });

  it("property: collision resistance across 1000 distinct type+ref pairs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(
            fc.constantFrom("tombstone", "zombie", "ghost", "crypt"),
            fc.string({ minLength: 1, maxLength: 80 })
          ),
          { minLength: 2, maxLength: 1000, selector: ([t, r]) => `${t}:${r}` }
        ),
        (pairs) => {
          const ids = pairs.map(([t, r]) => entityId(t, r));
          return new Set(ids).size === ids.length;
        }
      )
    );
  });
});

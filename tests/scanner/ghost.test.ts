import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectGhosts } from "../../scanner/ghost.js";
import type { SourceFile } from "../../scanner/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function file(path: string, content: string): SourceFile {
  return { path, content };
}

// ---------------------------------------------------------------------------
// Unit tests — deferred comments
// ---------------------------------------------------------------------------

describe("detectGhosts — deferred comments", () => {
  it("returns [] for an empty array", () => {
    expect(detectGhosts([])).toEqual([]);
  });

  it("flags a file containing a TODO comment", () => {
    const result = detectGhosts([file("src/foo.ts", "// TODO: fix this")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("ghost");
    expect(result[0]!.ref).toBe("src/foo.ts");
  });

  it("flags a file containing a FIXME comment", () => {
    const result = detectGhosts([file("src/foo.ts", "// FIXME: broken")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.ref).toBe("src/foo.ts");
  });

  it("flags a file containing a HACK comment", () => {
    const result = detectGhosts([file("src/foo.ts", "// HACK: works for now")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.ref).toBe("src/foo.ts");
  });

  it("is case-insensitive (todo, fixme, hack)", () => {
    const result = detectGhosts([file("src/foo.ts", "// todo: lowercase")]);
    expect(result).toHaveLength(1);
  });

  it("produces one entity per file regardless of comment count", () => {
    const content = ["// TODO: a", "// TODO: b", "// TODO: c"].join("\n");
    const result = detectGhosts([file("src/foo.ts", content)]);
    const fileEntities = result.filter((e) => e.ref === "src/foo.ts");
    expect(fileEntities).toHaveLength(1);
  });

  it("assigns severity 1 for 1–4 deferred comments", () => {
    const content = ["// TODO: a", "// FIXME: b"].join("\n");
    const result = detectGhosts([file("src/foo.ts", content)]);
    expect(result[0]!.severity).toBe(1);
  });

  it("assigns severity 2 for 5+ deferred comments", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `// TODO: ${i}`);
    const result = detectGhosts([file("src/foo.ts", lines.join("\n"))]);
    expect(result[0]!.severity).toBe(2);
  });

  it("includes the count in evidence", () => {
    const lines = Array.from({ length: 3 }, (_, i) => `// TODO: ${i}`);
    const result = detectGhosts([file("src/foo.ts", lines.join("\n"))]);
    const countEvidence = result[0]!.evidence.find(
      (e) => e.label === "Deferred comments"
    );
    expect(countEvidence?.value).toBe("3");
  });

  it("includes up to 3 sample lines in evidence", () => {
    const lines = Array.from({ length: 6 }, (_, i) => `// TODO: ${i}`);
    const result = detectGhosts([file("src/foo.ts", lines.join("\n"))]);
    const samples = result[0]!.evidence.filter((e) =>
      e.label.startsWith("Comment")
    );
    expect(samples).toHaveLength(3);
  });

  it("does not flag a TODO inside a URL", () => {
    const result = detectGhosts([
      file("src/foo.ts", "// see https://github.com/todo-app for details"),
    ]);
    expect(result).toHaveLength(0);
  });

  it("epitaph mentions the count and file path", () => {
    const result = detectGhosts([file("src/foo.ts", "// TODO: fix")]);
    expect(result[0]!.epitaph).toContain("src/foo.ts");
    expect(result[0]!.epitaph).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — skipped tests
// ---------------------------------------------------------------------------

describe("detectGhosts — skipped tests", () => {
  it("flags a line containing it.skip(", () => {
    const content = 'it.skip("should work", () => {})';
    const result = detectGhosts([file("src/foo.test.ts", content)]);
    // Should have exactly one skip entity (line 1)
    const skipEntities = result.filter((e) =>
      e.ref.includes("src/foo.test.ts:")
    );
    expect(skipEntities).toHaveLength(1);
    expect(skipEntities[0]!.severity).toBe(2);
  });

  it("includes the line number in ref", () => {
    const content = ["", 'it.skip("test", () => {})'].join("\n");
    const result = detectGhosts([file("src/foo.test.ts", content)]);
    const skip = result.find((e) => e.ref.includes(":"));
    expect(skip?.ref).toBe("src/foo.test.ts:2");
  });

  it("flags test.skip(", () => {
    const result = detectGhosts([
      file("src/a.test.ts", 'test.skip("x", () => {})'),
    ]);
    expect(result.some((e) => e.ref.includes("src/a.test.ts:"))).toBe(true);
  });

  it("flags xit(", () => {
    const result = detectGhosts([file("src/a.test.ts", 'xit("x", () => {})')]);
    expect(result.some((e) => e.ref.includes("src/a.test.ts:"))).toBe(true);
  });

  it("flags xtest(", () => {
    const result = detectGhosts([
      file("src/a.test.ts", 'xtest("x", () => {})'),
    ]);
    expect(result.some((e) => e.ref.includes("src/a.test.ts:"))).toBe(true);
  });

  it("flags xdescribe(", () => {
    const result = detectGhosts([
      file("src/a.test.ts", 'xdescribe("suite", () => {})'),
    ]);
    expect(result.some((e) => e.ref.includes("src/a.test.ts:"))).toBe(true);
  });

  it("flags describe.skip(", () => {
    const result = detectGhosts([
      file("src/a.test.ts", 'describe.skip("suite", () => {})'),
    ]);
    expect(result.some((e) => e.ref.includes("src/a.test.ts:"))).toBe(true);
  });

  it("produces a separate entity per skipped-test line", () => {
    const content = [
      'it.skip("a", () => {})',
      'it.skip("b", () => {})',
    ].join("\n");
    const result = detectGhosts([file("src/foo.test.ts", content)]);
    const skips = result.filter((e) => e.ref.includes("src/foo.test.ts:"));
    expect(skips).toHaveLength(2);
  });

  it("epitaph uses the correct pattern for skipped tests", () => {
    const result = detectGhosts([
      file("src/foo.test.ts", 'it.skip("x", () => {})'),
    ]);
    const skip = result.find((e) => e.ref.includes(":"));
    expect(skip?.epitaph).toMatch(
      /a test that never ran and never will/
    );
  });

  it("a file can produce both a deferred-comment entity and skip entities", () => {
    const content = [
      "// TODO: fix this",
      'it.skip("broken", () => {})',
    ].join("\n");
    const result = detectGhosts([file("src/foo.test.ts", content)]);
    // One file-level deferred entity + one skip entity
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

describe("detectGhosts — properties", () => {
  it("never throws on an empty array", () => {
    expect(() => detectGhosts([])).not.toThrow();
  });

  it("never throws on arbitrary SourceFile arrays", () => {
    const sourceFileArb = fc.record({
      path: fc.string({ minLength: 1, maxLength: 80 }),
      content: fc.string(),
    });
    fc.assert(
      fc.property(fc.array(sourceFileArb), (files) => {
        expect(() => detectGhosts(files)).not.toThrow();
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
            fc.record({ path: fc.string(), content: fc.string() })
          )
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (arr: any[]) => {
          expect(() => detectGhosts(arr)).not.toThrow();
        }
      )
    );
  });

  it("a file with no TODO/FIXME/HACK and no skip patterns produces no entities", () => {
    fc.assert(
      fc.property(
        fc.string().filter(
          (s) =>
            !/\b(TODO|FIXME|HACK)\b/i.test(s) &&
            !/\b(it\.skip|test\.skip|xit|xtest|xdescribe|describe\.skip)\s*\(/.test(
              s
            ) &&
            !/:\/\//.test(s)
        ),
        (content) => {
          const result = detectGhosts([{ path: "src/clean.ts", content }]);
          return result.length === 0;
        }
      )
    );
  });
});

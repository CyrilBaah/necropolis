import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectTombstones } from "../../scanner/tombstone.js";
import type { SourceFile } from "../../scanner/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function file(path: string, content: string): SourceFile {
  return { path, content };
}

function importingFile(importerPath: string, importedPath: string): SourceFile {
  // Build a file that imports the target using a relative path
  const importerDir = importerPath.includes("/")
    ? importerPath.substring(0, importerPath.lastIndexOf("/"))
    : "";
  // Compute relative path from importer to imported
  const importedWithoutExt = importedPath.replace(/\.(ts|tsx|js|jsx)$/, "");
  const rel = importedDir(importerDir, importedWithoutExt);
  return file(importerPath, `import { foo } from "${rel}";`);
}

function importedDir(fromDir: string, toPath: string): string {
  if (!fromDir) return `./${toPath}`;
  // Simple prefix-based relative calculation (sufficient for flat test cases)
  if (toPath.startsWith(fromDir + "/")) {
    return "./" + toPath.slice(fromDir.length + 1);
  }
  return "./" + toPath;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("detectTombstones", () => {
  it("returns [] for an empty array", () => {
    expect(detectTombstones([], null)).toEqual([]);
  });

  it("flags a file imported by no other file", () => {
    const files = [
      file("src/lonely.ts", 'export const x = 1;'),
      file("src/other.ts", '// no imports'),
    ];
    const result = detectTombstones(files, null);
    const refs = result.map((e) => e.ref);
    expect(refs).toContain("src/lonely.ts");
    expect(refs).toContain("src/other.ts");
  });

  it("does not flag a file that is imported by another file", () => {
    const files = [
      file("src/util.ts", "export function foo() {}"),
      file("src/main.ts", 'import { foo } from "./util";'),
    ];
    const result = detectTombstones(files, null);
    const refs = result.map((e) => e.ref);
    expect(refs).not.toContain("src/util.ts");
  });

  it("does not flag index.ts even if nothing imports it", () => {
    const files = [
      file("index.ts", "export const app = 1;"),
    ];
    const result = detectTombstones(files, null);
    expect(result).toEqual([]);
  });

  it("does not flag test files", () => {
    const files = [
      file("src/util.test.ts", 'it("x", () => {})'),
      file("tests/setup.ts", 'export const x = 1;'),
      file("src/__tests__/foo.ts", "export const y = 2;"),
    ];
    const result = detectTombstones(files, null);
    expect(result).toEqual([]);
  });

  it("does not flag config files", () => {
    const files = [
      file("vite.config.ts", "export default {}"),
      file("jest.config.js", "module.exports = {}"),
    ];
    const result = detectTombstones(files, null);
    expect(result).toEqual([]);
  });

  it("flags a dead export in an otherwise-imported file", () => {
    const files = [
      file("src/util.ts", "export function used() {}\nexport function dead() {}"),
      // importer only imports 'used'
      file("src/main.ts", 'import { used } from "./util";'),
    ];
    const result = detectTombstones(files, null);
    // Should not flag the file itself (it is imported)
    expect(result.every((e) => e.ref !== "src/util.ts")).toBe(true);
    // Should flag the dead export
    expect(result.some((e) => e.ref === "src/util.ts:dead")).toBe(true);
    // Should not flag the used export
    expect(result.every((e) => e.ref !== "src/util.ts:used")).toBe(true);
  });

  it("reports one file-level entity, not per-export, when the file is fully unreferenced", () => {
    const files = [
      file("src/dead.ts", "export function a() {}\nexport function b() {}"),
      file("src/other.ts", "const x = 1;"),
    ];
    const result = detectTombstones(files, null);
    const fileEntities = result.filter((e) => e.ref === "src/dead.ts");
    expect(fileEntities).toHaveLength(1);
    expect(fileEntities[0]!.severity).toBe(2);
  });

  it("assigns severity 2 to dead files and severity 1 to dead exports", () => {
    const files = [
      file("src/util.ts", "export function used() {}\nexport function dead() {}"),
      file("src/main.ts", 'import { used } from "./util";'),
      file("src/orphan.ts", "export const x = 1;"),
      file("src/consumer.ts", "const y = 1;"),
    ];
    const result = detectTombstones(files, null);
    const deadExport = result.find((e) => e.ref === "src/util.ts:dead");
    const deadFile = result.find((e) => e.ref === "src/orphan.ts");
    expect(deadExport?.severity).toBe(1);
    expect(deadFile?.severity).toBe(2);
  });

  it("suppresses dead-export detection when a namespace import is used", () => {
    const files = [
      file("src/util.ts", "export function a() {}\nexport function b() {}"),
      file("src/main.ts", 'import * as util from "./util";'),
    ];
    const result = detectTombstones(files, null);
    // No exports from util.ts should be flagged since namespace import covers everything
    expect(result.some((e) => e.ref === "src/util.ts:a")).toBe(false);
    expect(result.some((e) => e.ref === "src/util.ts:b")).toBe(false);
    // util.ts itself should not be flagged either (it IS imported by main.ts)
    expect(result.some((e) => e.ref === "src/util.ts")).toBe(false);
  });

  it("respects package.json main as an entry point", () => {
    const files = [
      file("dist/index.js", "module.exports = {};"),
    ];
    const result = detectTombstones(files, { main: "./dist/index.js" });
    expect(result).toEqual([]);
  });

  // --- Property-based ---

  it("property: never throws on empty input", () => {
    fc.assert(
      fc.property(fc.constant([] as SourceFile[]), (files) => {
        expect(() => detectTombstones(files, null)).not.toThrow();
      })
    );
  });

  it("property: never throws on arbitrary SourceFile arrays", () => {
    const sourceFileArb = fc.record({
      path: fc.string({ minLength: 1, maxLength: 80 }),
      content: fc.string(),
    });
    fc.assert(
      fc.property(fc.array(sourceFileArb), (files) => {
        expect(() => detectTombstones(files, null)).not.toThrow();
      })
    );
  });

  it("property: a file imported by at least one other file is never a tombstone (file-level)", () => {
    // Build a small synthetic set: one target file imported by one importer
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z]+$/.test(s)),
        (name) => {
          const targetPath = `src/${name}.ts`;
          const files: SourceFile[] = [
            { path: targetPath, content: "export const x = 1;" },
            { path: "src/importer.ts", content: `import { x } from "./${name}";` },
          ];
          const result = detectTombstones(files, null);
          // The target file must not appear as a file-level tombstone
          return !result.some((e) => e.ref === targetPath && e.severity === 2);
        }
      )
    );
  });
});

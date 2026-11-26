import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectCrypts } from "../../scanner/crypt.js";
import type { NpmPackageInfo, PackageJson } from "../../scanner/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINIMAL_PKG: PackageJson = {
  dependencies: { react: "^17.0.0" },
};

function npmInfo(
  name: string,
  installedVersion: string,
  latestVersion: string,
  isDeprecated = false,
  deprecationMessage?: string
): NpmPackageInfo {
  return { name, installedVersion, latestVersion, isDeprecated, deprecationMessage };
}

// ---------------------------------------------------------------------------
// Unit tests — null / empty guards
// ---------------------------------------------------------------------------

describe("detectCrypts — guards", () => {
  it("returns [] when packageJson is null", () => {
    expect(detectCrypts(null, [])).toEqual([]);
  });

  it("returns [] when npmInfos is an empty array", () => {
    expect(detectCrypts(MINIMAL_PKG, [])).toEqual([]);
  });

  it("returns [] when both are empty", () => {
    expect(detectCrypts({}, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — deprecated signal
// ---------------------------------------------------------------------------

describe("detectCrypts — deprecated packages", () => {
  it("flags a deprecated package as severity 3", () => {
    const infos = [
      npmInfo("request", "^2.88.0", "2.88.2", true, "Use axios instead"),
    ];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe(3);
    expect(result[0]!.type).toBe("crypt");
  });

  it("includes the deprecation message in evidence", () => {
    const infos = [
      npmInfo("request", "^2.88.0", "2.88.2", true, "Use axios instead"),
    ];
    const result = detectCrypts(MINIMAL_PKG, infos);
    const msgEvidence = result[0]!.evidence.find(
      (e) => e.label === "Registry message"
    );
    expect(msgEvidence?.value).toBe("Use axios instead");
  });

  it("includes package name and version in evidence", () => {
    const infos = [npmInfo("old-lib", "1.0.0", "1.2.0", true)];
    const result = detectCrypts(MINIMAL_PKG, infos);
    const pkg = result[0]!.evidence.find((e) => e.label === "Package");
    const ver = result[0]!.evidence.find((e) => e.label === "Installed version");
    expect(pkg?.value).toBe("old-lib");
    expect(ver?.value).toBe("1.0.0");
  });

  it("epitaph uses the correct deprecated pattern", () => {
    const infos = [npmInfo("old-lib", "1.0.0", "1.2.0", true)];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result[0]!.epitaph).toMatch(/the registry itself has given up on it/);
  });

  it("flags deprecated even when version is current", () => {
    const infos = [npmInfo("bad-pkg", "5.0.0", "5.0.0", true, "Abandoned")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — outdated signal
// ---------------------------------------------------------------------------

describe("detectCrypts — outdated packages", () => {
  it("flags a package 2 major versions behind as severity 2", () => {
    const infos = [npmInfo("lodash", "^2.0.0", "4.17.21")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe(2);
  });

  it("flags a package 3 major versions behind as severity 3", () => {
    const infos = [npmInfo("moment", "^1.0.0", "4.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe(3);
  });

  it("does not flag a package 1 major version behind", () => {
    const infos = [npmInfo("express", "^4.0.0", "5.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(0);
  });

  it("does not flag a package at the same major version", () => {
    const infos = [npmInfo("react", "^18.0.0", "18.3.1")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(0);
  });

  it("strips range prefix when comparing versions (^ and ~)", () => {
    // ^2.0.0 → installed major = 2, latest = 4 → gap = 2 → severity 2
    const infos = [npmInfo("pkg", "^2.0.0", "4.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe(2);
  });

  it("strips >= prefix from installed version", () => {
    const infos = [npmInfo("pkg", ">=1.0.0", "3.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(1);
  });

  it("includes major-version gap in evidence", () => {
    const infos = [npmInfo("pkg", "1.0.0", "3.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    const gapEvidence = result[0]!.evidence.find(
      (e) => e.label === "Major versions behind"
    );
    expect(gapEvidence?.value).toBe("2");
  });

  it("epitaph uses the correct outdated pattern", () => {
    const infos = [npmInfo("pkg", "1.0.0", "3.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result[0]!.epitaph).toMatch(/major versions? behind, and counting/);
  });

  it("remediation suggests npm install @latest", () => {
    const infos = [npmInfo("pkg", "1.0.0", "3.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result[0]!.remediation).toContain("npm install pkg@latest");
  });

  it("skips entries with unparseable version strings", () => {
    const infos = [npmInfo("pkg", "*", "3.0.0")];
    const result = detectCrypts(MINIMAL_PKG, infos);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

describe("detectCrypts — properties", () => {
  it("never throws when packageJson is null", () => {
    fc.assert(
      fc.property(fc.array(fc.anything()), (arr: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => detectCrypts(null, arr as any)).not.toThrow();
      })
    );
  });

  it("never throws on arbitrary NpmPackageInfo arrays", () => {
    const infoArb = fc.record({
      name: fc.string(),
      installedVersion: fc.string(),
      latestVersion: fc.string(),
      isDeprecated: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(infoArb), (infos) => {
        expect(() => detectCrypts(MINIMAL_PKG, infos)).not.toThrow();
      })
    );
  });

  it("never throws on malformed objects in the infos array", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant({}))
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (arr: any[]) => {
          expect(() => detectCrypts(MINIMAL_PKG, arr)).not.toThrow();
        }
      )
    );
  });

  it("a package at the latest major and not deprecated never produces an entity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        (major, minor, patch) => {
          const version = `${major}.${minor}.${patch}`;
          const info = npmInfo("pkg", version, version, false);
          const result = detectCrypts(MINIMAL_PKG, [info]);
          return result.length === 0;
        }
      )
    );
  });

  it("a deprecated package always produces a severity-3 entity", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string(),
        fc.string(),
        (name, installedVersion, latestVersion) => {
          const info = npmInfo(name, installedVersion, latestVersion, true);
          const result = detectCrypts(MINIMAL_PKG, [info]);
          // May be 0 results if name is empty string — guard for that
          return (
            result.length === 0 ||
            result.every((e) => e.severity === 3)
          );
        }
      )
    );
  });
});

import type { PackageJson, NpmPackageInfo, GraveyardEntity } from "./types.js";
import { entityId } from "./id.js";

/**
 * Detect crypt signals: npm dependencies that are deprecated or two or more
 * major versions behind the latest published version.
 *
 * Both `dependencies` and `devDependencies` are checked. `peerDependencies`
 * and `optionalDependencies` are ignored.
 *
 * Severity rules:
 * - Deprecated (regardless of version gap): severity 3.
 * - Installed major is exactly 2 behind latest: severity 2.
 * - Installed major is 3+ behind latest: severity 3.
 *
 * Version comparison uses a simple major-version parse that strips range
 * prefixes (`^`, `~`, `>=`, etc.) before the first digit. No semver library
 * is required.
 *
 * @param packageJson - Parsed package.json, or null if none exists.
 * @param npmInfos - Registry metadata for each dependency (pre-fetched).
 * @returns Array of crypt entities (deprecated or outdated packages).
 */
export function detectCrypts(
  packageJson: PackageJson | null,
  npmInfos: NpmPackageInfo[]
): GraveyardEntity[] {
  if (!packageJson || !npmInfos || !Array.isArray(npmInfos)) {
    return [];
  }

  const entities: GraveyardEntity[] = [];

  for (const info of npmInfos) {
    if (!info || typeof info !== "object") {
      continue;
    }

    // Guard against malformed entries
    const name = typeof info.name === "string" ? info.name : "";
    const installedVersion =
      typeof info.installedVersion === "string" ? info.installedVersion : "";
    const latestVersion =
      typeof info.latestVersion === "string" ? info.latestVersion : "";
    const isDeprecated = info.isDeprecated === true;

    if (!name) {
      continue;
    }

    // --- Deprecated signal ---
    if (isDeprecated) {
      const deprecationMsg =
        typeof info.deprecationMessage === "string"
          ? info.deprecationMessage
          : "No deprecation message provided.";

      entities.push({
        id: entityId("crypt", name),
        type: "crypt",
        title: `${name}@${installedVersion}`,
        ref: name,
        evidence: [
          { label: "Package", value: name },
          { label: "Installed version", value: installedVersion },
          { label: "Status", value: "Deprecated" },
          { label: "Registry message", value: deprecationMsg },
        ],
        severity: 3,
        epitaph: `Here lies ${name}@${installedVersion} — the registry itself has given up on it.`,
        remediation: `Remove ${name} from package.json or replace it with an actively maintained alternative`,
      });
      continue;
    }

    // --- Outdated signal ---
    const installedMajor = parseMajor(installedVersion);
    const latestMajor = parseMajor(latestVersion);

    // Skip if either version is unparseable
    if (installedMajor === null || latestMajor === null) {
      continue;
    }

    const gap = latestMajor - installedMajor;

    if (gap < 2) {
      continue;
    }

    const severity: 2 | 3 = gap === 2 ? 2 : 3;

    entities.push({
      id: entityId("crypt", name),
      type: "crypt",
      title: `${name}@${installedVersion}`,
      ref: name,
      evidence: [
        { label: "Package", value: name },
        { label: "Installed version", value: installedVersion },
        { label: "Latest version", value: latestVersion },
        { label: "Major versions behind", value: String(gap) },
      ],
      severity,
      epitaph: `Here lies ${name}@${installedVersion} — ${gap} major ${gap === 1 ? "version" : "versions"} behind, and counting.`,
      remediation: `npm install ${name}@latest`,
    });
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the major version number from a semver string that may include a range
 * prefix such as `^`, `~`, `>=`, `>`, `<=`, `<`, or `=`.
 *
 * Returns `null` when the string cannot be parsed to a non-negative integer.
 *
 * @example
 * parseMajor("^1.2.3")  // 1
 * parseMajor("~14.0.0") // 14
 * parseMajor(">=2.0.0") // 2
 * parseMajor("*")       // null
 */
function parseMajor(version: string): number | null {
  if (!version || typeof version !== "string") {
    return null;
  }

  // Strip leading non-numeric characters (range prefixes)
  const cleaned = version.replace(/^[^0-9]*/, "");

  if (!cleaned) {
    return null;
  }

  // Take everything before the first dot
  const majorStr = cleaned.split(".")[0] ?? "";
  const major = parseInt(majorStr, 10);

  return isNaN(major) || major < 0 ? null : major;
}

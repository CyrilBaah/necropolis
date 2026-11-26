import { fetchRepoDataWithCache } from "../lib/github/demo-cache.js";
import { detectTombstones } from "./tombstone.js";
import { detectZombies } from "./zombie.js";
import { detectGhosts } from "./ghost.js";
import { detectCrypts } from "./crypt.js";
import { computeHealthScore } from "./health.js";
import { InvalidRepoUrlError } from "./errors.js";
import type { ScanInput, ScanResult, RepoMeta } from "./types.js";

/**
 * Scan a public GitHub repository for tech debt signals.
 *
 * This is the top-level entry point to the Necropolis scanner. It orchestrates:
 * 1. URL parsing and validation.
 * 2. Data fetching (via the demo cache layer, which delegates to the GitHub API).
 * 3. Running all four detectors in parallel.
 * 4. Computing a health score from the aggregated entities.
 *
 * The function sets `scannedAt` to the wall-clock time at call start (before
 * any await) so the timestamp reflects when the scan was initiated, not when
 * it completed.
 *
 * **Error behaviour:**
 * - Throws `InvalidRepoUrlError` if the URL is not a valid GitHub repo URL.
 * - Throws `RepoNotFoundError` if the GitHub API returns 404.
 * - Throws `RateLimitError` if the rate limit is exhausted.
 * - Domain-level emptiness (empty repo, no findings) returns a valid
 *   `ScanResult` with `entities: []` and `healthScore: 100` — never throws.
 *
 * @param input - The repository URL and optional access token.
 * @returns A complete scan result ready for the UI.
 *
 * @throws {InvalidRepoUrlError} When the URL cannot be parsed.
 * @throws {RepoNotFoundError} When the repository is not found (HTTP 404).
 * @throws {RateLimitError} When the GitHub API rate limit is exhausted.
 */
export async function scanRepo(input: ScanInput): Promise<ScanResult> {
  // Set the scan timestamp before any async work (REQ-9.3).
  const scannedAt = new Date().toISOString();

  // --- 1. Parse and validate the URL ---
  const { owner, repo } = parseRepoUrl(input.repoUrl);

  const repoMeta: RepoMeta = {
    owner,
    repo,
    url: `https://github.com/${owner}/${repo}`,
  };

  try {
    // --- 2. Fetch repository data ---
    const data = await fetchRepoDataWithCache(owner, repo, input.token);

    // --- 3. Run detectors in parallel ---
    const [tombstones, zombies, ghosts, crypts] = await Promise.all([
      Promise.resolve(detectTombstones(data.files, data.packageJson)),
      Promise.resolve(detectZombies(data.branches, data.pullRequests, new Date())),
      Promise.resolve(detectGhosts(data.files)),
      Promise.resolve(detectCrypts(data.packageJson, data.npmInfos)),
    ]);

    const entities = [...tombstones, ...zombies, ...ghosts, ...crypts];

    // --- 4. Compute health score ---
    const healthScore = computeHealthScore(entities);

    return {
      repo: repoMeta,
      entities,
      healthScore,
      scannedAt,
      truncated: data.truncated,
    };
  } catch (err) {
    // Re-throw known scanner errors (REQ-10.2: InvalidRepoUrlError,
    // RepoNotFoundError, RateLimitError). InvalidRepoUrlError is already
    // thrown above and won't reach this catch. The other two come from the
    // fetcher.
    //
    // Any other error (e.g., fetch network failure, JSON parse failure) is
    // treated as a domain error — return an empty, healthy result (REQ-10.1).
    if (
      err instanceof Error &&
      (err.name === "RepoNotFoundError" || err.name === "RateLimitError")
    ) {
      throw err;
    }

    // Domain error: return a valid but empty result.
    return {
      repo: repoMeta,
      entities: [],
      healthScore: 100,
      scannedAt,
      truncated: false,
    };
  }
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub repository URL into `{owner, repo}`.
 *
 * Accepts:
 * - `https://github.com/owner/repo`
 * - `https://github.com/owner/repo.git`
 * - `github.com/owner/repo` (auto-prepends https://)
 *
 * Rejects anything else with `InvalidRepoUrlError`.
 */
function parseRepoUrl(url: string): { owner: string; repo: string } {
  if (!url || typeof url !== "string") {
    throw new InvalidRepoUrlError(url);
  }

  // Normalise: prepend https:// if it's missing
  let normalised = url.trim();
  if (!normalised.startsWith("http://") && !normalised.startsWith("https://")) {
    normalised = `https://${normalised}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalised);
  } catch {
    throw new InvalidRepoUrlError(url);
  }

  // Must be github.com
  if (parsed.hostname !== "github.com") {
    throw new InvalidRepoUrlError(url);
  }

  // Path must be /{owner}/{repo} (or /{owner}/{repo}.git)
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new InvalidRepoUrlError(url);
  }

  const owner = pathParts[0]!;
  let repo = pathParts[1]!;

  // Strip .git suffix if present
  if (repo.endsWith(".git")) {
    repo = repo.slice(0, -4);
  }

  if (!owner || !repo) {
    throw new InvalidRepoUrlError(url);
  }

  return { owner, repo };
}

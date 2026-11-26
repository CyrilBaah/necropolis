import { fetchRepoData } from "./fetcher.js";
import type { RepoData } from "../../scanner/types.js";

// Load JSON fixtures using require() — compatible with NodeNext CommonJS output.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const facebookReactFixture = require("./fixtures/facebook-react.json") as RepoData;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vercelNextFixture = require("./fixtures/vercel-next.json") as RepoData;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const expressjsExpressFixture = require("./fixtures/expressjs-express.json") as RepoData;

/**
 * Map of known demo repos to their fixture data.
 * Keys are lowercased `{owner}/{repo}` strings.
 */
const FIXTURES = new Map<string, RepoData>([
  ["facebook/react", facebookReactFixture as RepoData],
  ["vercel/next.js", vercelNextFixture as RepoData],
  ["expressjs/express", expressjsExpressFixture as RepoData],
]);

/**
 * Fetch repository data with a demo cache layer.
 *
 * Before hitting the GitHub API, check whether the requested repo is one of
 * the three pre-cached demo repositories. If it is, return fixture data
 * immediately without any network call. Otherwise, delegate to the real fetcher.
 *
 * The fixture check is case-insensitive on `{owner}/{repo}`.
 *
 * @param owner - Repository owner.
 * @param repo  - Repository name.
 * @param token - Optional personal access token (ignored if fixture is used).
 * @returns `RepoData` from the fixture or the live GitHub API.
 */
export async function fetchRepoDataWithCache(
  owner: string,
  repo: string,
  token?: string
): Promise<RepoData> {
  const key = `${owner}/${repo}`.toLowerCase();
  const fixture = FIXTURES.get(key);

  if (fixture) {
    // Return a shallow clone so the caller can mutate the result without
    // affecting the fixture for future calls.
    return { ...fixture };
  }

  return fetchRepoData(owner, repo, token);
}

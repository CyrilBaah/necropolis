import { githubGet } from "./client.js";
import type {
  RepoData,
  SourceFile,
  BranchInfo,
  PullRequestInfo,
  PackageJson,
  NpmPackageInfo,
} from "../../scanner/types.js";

/** Maximum number of files fetched from any single repository. */
const FILE_CAP = 500;

/** Concurrency limit for parallel fetch operations. */
const CONCURRENCY = 10;

/** JS/TS extensions that get priority in the file cap. */
const JS_TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// GitHub API response shapes (internal — not exported)
// ---------------------------------------------------------------------------

interface GitTreeItem {
  path: string;
  type: "blob" | "tree";
  url: string;
}

interface GitTreeResponse {
  tree: GitTreeItem[];
  truncated?: boolean;
}

interface BlobResponse {
  content: string;
  encoding: string;
}

interface GithubBranch {
  name: string;
  commit: {
    commit: {
      committer?: { date?: string };
      author?: { date?: string };
    };
  };
  protection?: { enabled: boolean };
}

interface GithubPR {
  number: number;
  title: string;
  state: string;
  updated_at: string;
  head: { ref: string; sha: string };
}

interface GithubRepoInfo {
  default_branch: string;
}

interface NpmRegistryLatest {
  version: string;
  deprecated?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all data needed to run the four detectors against a GitHub repository.
 *
 * Steps:
 * 1. Fetch the recursive git tree.
 * 2. Prioritise JS/TS files (shallowest first) and apply the 500-file cap.
 * 3. Fetch file contents in parallel (concurrency 10).
 * 4. Fetch branches (with last-commit dates).
 * 5. Fetch open PRs.
 * 6. Parse package.json from the fetched files.
 * 7. Fetch npm registry metadata for each dependency (concurrency 10).
 *
 * @param owner - Repository owner (GitHub username or org).
 * @param repo  - Repository name.
 * @param token - Optional personal access token.
 * @returns Aggregated `RepoData` ready for the detectors.
 */
export async function fetchRepoData(
  owner: string,
  repo: string,
  token?: string
): Promise<RepoData> {
  const base = `/repos/${owner}/${repo}`;

  // --- 1. Fetch the recursive tree ---
  const treeResp = (await githubGet(
    `${base}/git/trees/HEAD?recursive=1`,
    token
  )) as GitTreeResponse;

  const allBlobs = (treeResp.tree ?? []).filter(
    (item) => item.type === "blob" && typeof item.path === "string"
  );

  // --- 2. Prioritise and cap ---
  const jstsFiles = allBlobs
    .filter((item) => JS_TS_EXTENSIONS.test(item.path))
    .sort(
      (a, b) =>
        pathDepth(a.path) - pathDepth(b.path) ||
        a.path.localeCompare(b.path)
    );

  const otherFiles = allBlobs.filter(
    (item) => !JS_TS_EXTENSIONS.test(item.path)
  );

  const prioritised = [...jstsFiles, ...otherFiles];
  const truncated = prioritised.length > FILE_CAP;
  const selected = prioritised.slice(0, FILE_CAP);

  // --- 3. Fetch file contents in parallel ---
  const sourceFiles = await fetchInBatches(
    selected,
    CONCURRENCY,
    async (item) => {
      try {
        const blob = (await githubGet(
          `${base}/git/blobs/${blobShaFromUrl(item.url)}`,
          token
        )) as BlobResponse;
        const content = decodeContent(blob);
        return { path: item.path, content } satisfies SourceFile;
      } catch {
        // If a single file fails (e.g. binary blob), skip it rather than
        // aborting the whole scan.
        return null;
      }
    }
  );

  const files: SourceFile[] = sourceFiles.filter(
    (f): f is SourceFile => f !== null
  );

  // --- 4. Fetch repo info + branches in parallel ---
  const [repoInfo, branchesRaw] = await Promise.all([
    githubGet(base, token) as Promise<GithubRepoInfo>,
    githubGet(`${base}/branches?per_page=100`, token) as Promise<
      GithubBranch[]
    >,
  ]);

  const defaultBranch = repoInfo.default_branch ?? "main";

  const branches: BranchInfo[] = (branchesRaw ?? []).map((b) => ({
    name: b.name,
    lastCommitDate:
      b.commit?.commit?.committer?.date ??
      b.commit?.commit?.author?.date ??
      new Date(0).toISOString(),
    isDefault: b.name === defaultBranch,
  }));

  // --- 5. Fetch open PRs (all pages up to 100 per page) ---
  const prsRaw = (await githubGet(
    `${base}/pulls?state=open&per_page=100`,
    token
  )) as GithubPR[];

  const pullRequests: PullRequestInfo[] = (prsRaw ?? []).map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: "open" as const,
    lastActivityDate: pr.updated_at,
    headRef: pr.head.ref,
  }));

  // --- 6. Parse package.json ---
  const packageJsonFile = files.find((f) => f.path === "package.json");
  let packageJson: PackageJson | null = null;
  if (packageJsonFile) {
    try {
      packageJson = JSON.parse(packageJsonFile.content) as PackageJson;
    } catch {
      packageJson = null;
    }
  }

  // --- 7. Fetch npm registry metadata ---
  const allDeps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  const depEntries = Object.entries(allDeps);

  const npmInfos = await fetchInBatches(
    depEntries,
    CONCURRENCY,
    async ([name, installedVersion]) => {
      try {
        const data = (await fetchNpmLatest(name)) as NpmRegistryLatest;
        const info: NpmPackageInfo = {
          name,
          installedVersion,
          latestVersion: data.version ?? installedVersion,
          isDeprecated: typeof data.deprecated === "string",
          deprecationMessage:
            typeof data.deprecated === "string" ? data.deprecated : undefined,
        };
        return info;
      } catch {
        return null;
      }
    }
  );

  return {
    files,
    branches,
    pullRequests,
    packageJson,
    npmInfos: npmInfos.filter((n): n is NpmPackageInfo => n !== null),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// npm registry helper (separate from githubGet — different base URL)
// ---------------------------------------------------------------------------

async function fetchNpmLatest(packageName: string): Promise<unknown> {
  // Scoped packages need the @ encoded as %40 in some contexts, but the
  // registry accepts the literal form fine.
  const url = `https://registry.npmjs.org/${packageName}/latest`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry request failed for ${packageName}: ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

/**
 * Run an async task over an array with a maximum concurrency limit.
 * Returns results in input order; failed tasks that return null are included.
 */
async function fetchInBatches<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await task(items[i]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function pathDepth(path: string): number {
  return (path.match(/\//g) ?? []).length;
}

/**
 * Extract the blob SHA from a GitHub blob URL.
 * URL form: https://api.github.com/repos/{owner}/{repo}/git/blobs/{sha}
 */
function blobShaFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * Decode a GitHub blob response to a UTF-8 string.
 * GitHub returns base64-encoded content with newlines; we strip them before decoding.
 */
function decodeContent(blob: BlobResponse): string {
  if (blob.encoding === "base64") {
    const cleaned = blob.content.replace(/\n/g, "");
    return Buffer.from(cleaned, "base64").toString("utf-8");
  }
  // "utf-8" encoding is returned as-is
  return blob.content;
}

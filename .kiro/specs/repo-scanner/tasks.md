# Repo Scanner — Tasks

## Task 1 — Shared types

Create `scanner/types.ts` with all interfaces defined in REQ-1.1–REQ-1.5, REQ-3.2–REQ-3.3, and REQ-5.2.

Interfaces to define:
- `ScanInput`
- `ScanResult`
- `GraveyardEntity`
- `Evidence`
- `EntityType` (union: `"tombstone" | "zombie" | "ghost" | "crypt"`)
- `Severity` (union: `1 | 2 | 3`)
- `SourceFile` (`{ path: string; content: string }`)
- `BranchInfo`
- `PullRequestInfo`
- `PackageJson` (loose: `{ dependencies?: Record<string, string>; devDependencies?: Record<string, string>; main?: string; exports?: unknown }`)
- `NpmPackageInfo`
- `RepoData` (internal aggregate returned by the fetcher: `{ files: SourceFile[]; branches: BranchInfo[]; pullRequests: PullRequestInfo[]; packageJson: PackageJson | null; npmInfos: NpmPackageInfo[]; truncated: boolean }`)

Also create the three typed error classes in `scanner/errors.ts`:
- `InvalidRepoUrlError extends Error`
- `RepoNotFoundError extends Error`
- `RateLimitError extends Error` (constructor takes `resetAt: Date | null`)

_Acceptance:_ `tsc --noEmit` passes. No runtime code, only types and error classes.

---

## Task 2 — Entity id utility

Create `scanner/id.ts` implementing `entityId(type: string, ref: string): string` as described in the design doc (SHA-1, 16-char hex prefix).

_Acceptance:_ `entityId("tombstone", "src/foo.ts")` returns the same 16-char string on every call. `entityId("tombstone", "src/foo.ts") !== entityId("ghost", "src/foo.ts")`.

---

## Task 3 — Tombstone detector

Create `scanner/tombstone.ts`.

Exported function:
```ts
detectTombstones(files: SourceFile[], packageJson: PackageJson | null): GraveyardEntity[]
```

Implement per REQ-2.1–REQ-2.7 and the regex-based design in `design.md` (import graph, entry-point exclusion, dead-file rule, dead-export rule).

_Acceptance:_
- A file imported by no other file (and not an entry point/config/test) produces one entity.
- A file with one unreferenced export among two exports produces one entity for the export, not the file.
- An entry point (`index.ts`) is never flagged, even if nothing imports it.
- Returns `[]` for an empty input array.

---

## Task 4 — Zombie detector

Create `scanner/zombie.ts`.

Exported function:
```ts
detectZombies(
  branches: BranchInfo[],
  pullRequests: PullRequestInfo[],
  now: Date
): GraveyardEntity[]
```

Implement per REQ-3.1–REQ-3.8 and the deduplication design (zombie PR suppresses its branch).

_Acceptance:_
- A branch last committed 91 days ago (not default) produces one entity.
- A branch last committed 30 days ago produces no entity.
- A zombie branch whose `name` matches a zombie PR's `headRef` produces one entity total (the PR), not two.
- Returns `[]` for empty inputs.

---

## Task 5 — Ghost detector

Create `scanner/ghost.ts`.

Exported function:
```ts
detectGhosts(files: SourceFile[]): GraveyardEntity[]
```

Implement per REQ-4.1–REQ-4.5 (two-pass line scan: deferred comments and skipped tests).

_Acceptance:_
- A file containing `// TODO: fix this` produces one entity for the file.
- A file containing five `TODO` comments produces a severity-2 entity.
- A line containing `it.skip("..."` produces a severity-2 entity with the line number in `ref`.
- A line inside a URL (`https://github.com/todo-app`) is not flagged.
- Returns `[]` for an empty input array.

---

## Task 6 — Crypt detector

Create `scanner/crypt.ts`.

Exported function:
```ts
detectCrypts(
  packageJson: PackageJson | null,
  npmInfos: NpmPackageInfo[]
): GraveyardEntity[]
```

Implement per REQ-5.1–REQ-5.6 (deprecated flag, major-version delta).

_Acceptance:_
- A deprecated package produces a severity-3 entity with the deprecation message in evidence.
- A package 2 major versions behind produces a severity-2 entity.
- A package 3+ major versions behind produces a severity-3 entity.
- A package at the latest major produces no entity.
- Returns `[]` when `packageJson` is `null`.

---

## Task 7 — Health score

Create `scanner/health.ts`.

Exported function:
```ts
computeHealthScore(entities: GraveyardEntity[]): number
```

Implement per REQ-6.1–REQ-6.5 and the design doc formula.

_Acceptance:_
- `computeHealthScore([])` returns `100`.
- Score never exceeds 100 or falls below 0.
- 10 severity-3 entities yield score 0 (100 - 100 = 0).
- 1 severity-1 entity yields score 98.

---

## Task 8 — GitHub API client

Create `lib/github/client.ts`.

Implements a thin fetch wrapper:
```ts
githubGet(path: string, token?: string): Promise<unknown>
```

- Sets `Authorization: Bearer {token}` when token is present.
- Sets `Accept: application/vnd.github+json`.
- Checks `X-RateLimit-Remaining` per REQ-7.2 and throws `RateLimitError`.
- Throws `RepoNotFoundError` on HTTP 404.
- Returns parsed JSON on 200.

_Acceptance:_ unit tests mock `fetch`; verify the auth header is set when a token is provided, absent when not; verify `RateLimitError` is thrown when remaining = 0; verify `RepoNotFoundError` on 404.

---

## Task 9 — Repo data fetcher

Create `lib/github/fetcher.ts`.

Exported function:
```ts
fetchRepoData(owner: string, repo: string, token?: string): Promise<RepoData>
```

Steps (per design doc and REQ-7.3–REQ-7.5):
1. Fetch the recursive file tree via the Trees API.
2. Separate and prioritise JS/TS files; apply the 500-file cap; set `truncated`.
3. Fetch file contents in parallel (concurrency 10) using `lib/github/client.ts`.
4. Fetch branches.
5. Fetch open PRs.
6. Find and parse `package.json` from the fetched files.
7. For each dependency in `package.json`, fetch npm registry metadata (concurrency 10).
8. Return `RepoData`.

_Acceptance:_ integration test with mocked `fetch` verifies the 500-file cap and that `truncated` is set correctly; verifies npm registry is called once per unique dependency.

---

## Task 10 — Demo cache

Create `lib/github/demo-cache.ts`.

Exported function:
```ts
fetchRepoDataWithCache(owner: string, repo: string, token?: string): Promise<RepoData>
```

- Checks whether `{owner}/{repo}` is one of the three demo repos (case-insensitive).
- If yes, imports and returns the corresponding fixture from `lib/github/fixtures/`.
- If no, delegates to `fetchRepoData`.

Create stub fixture files at:
- `lib/github/fixtures/facebook-react.json`
- `lib/github/fixtures/vercel-next.json`
- `lib/github/fixtures/expressjs-express.json`

Stubs only need enough data to pass a type check (`RepoData` shape with empty arrays and `truncated: false`). Full fixture generation is a separate offline step.

_Acceptance:_ calling `fetchRepoDataWithCache("facebook", "react")` returns fixture data without calling `fetchRepoData`. Calling it for an unknown repo delegates to the real fetcher.

---

## Task 11 — Scanner entry point

Create `scanner/index.ts` implementing `scanRepo(input: ScanInput): Promise<ScanResult>`.

Wire together: URL parsing → `fetchRepoDataWithCache` → `Promise.all([detectTombstones, detectZombies, detectGhosts, detectCrypts])` → `computeHealthScore` → return `ScanResult`.

Implement URL parsing: extract `owner` and `repo` from `https://github.com/{owner}/{repo}`, throw `InvalidRepoUrlError` for anything else (REQ-7.4).

Implement the domain-error catch behaviour from REQ-10.1: an empty or parse-failing repo returns a valid `ScanResult` with `entities: []` and `healthScore: 100`. Re-throw `InvalidRepoUrlError`, `RepoNotFoundError`, and `RateLimitError`.

Set `scannedAt` to `new Date().toISOString()` before fetching begins (REQ-9.3).

_Acceptance:_
- `scanRepo({ repoUrl: "https://github.com/facebook/react" })` resolves (using fixture) with a valid `ScanResult`.
- `scanRepo({ repoUrl: "not-a-url" })` throws `InvalidRepoUrlError`.
- `scannedAt` is set before any await.

---

## Task 12 — Property-based tests

Create test files using Vitest + fast-check.

### `tests/scanner/health.test.ts`
- Score is always in `[0, 100]` for any array of entities.
- Score is 100 for an empty array.
- Removing any entity never lowers the score.
- Adding a severity-1 entity to a score above 2 reduces the score by exactly 2.

### `tests/scanner/tombstone.test.ts`
- `detectTombstones` never throws for any array of `SourceFile`-shaped objects.
- A file that appears in another file's import is never in the result.

### `tests/scanner/zombie.test.ts`
- `detectZombies` never throws for any arrays and any `Date`.
- A branch with `lastCommitDate` within 90 days of `now` never appears in results.

### `tests/scanner/ghost.test.ts`
- `detectGhosts` never throws for any array of `SourceFile`-shaped objects.
- A file whose content contains no TODO/FIXME/HACK and no skip pattern produces no entities.

### `tests/scanner/crypt.test.ts`
- `detectCrypts` never throws for `null` packageJson or any array of `NpmPackageInfo`.
- A package where `installedVersion` major equals `latestVersion` major and `isDeprecated` is false produces no entity.

### `tests/scanner/id.test.ts`
- `entityId(type, ref)` is stable (same inputs → same output).
- `entityId` produces distinct ids for distinct `type+ref` pairs across 1000 generated pairs (collision resistance).

_Acceptance:_ `npx vitest run` passes with no failures.

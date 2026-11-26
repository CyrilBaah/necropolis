# Repo Scanner — Requirements

## Background

The scanner is the core analysis engine of Necropolis. Given a public GitHub repository URL and an optional personal access token, it fetches enough data about the repo to run four detectors, then returns a "graveyard" payload: a typed list of entities and a health score.

### Entity type clarification

This spec defines four entity types that differ slightly from the initial steering doc (`product.md`). The spec takes precedence:

| Entity | Signal | Steering doc equivalent |
|---|---|---|
| **Tombstone** | JS/TS files or exports with no inbound imports | Tombstone (same) |
| **Zombie** | Branches and open PRs with no activity for 90+ days | *(new — replaces Wraith)* |
| **Ghost** | TODO/FIXME/HACK comments and skipped tests | *(new — replaces Ghost/stale-files)* |
| **Crypt** | npm dependencies that are deprecated or 2+ major versions behind | Crypt (redefined) |

The `wraith.ts` detector (orphaned deps) and `ghost.ts` (stale files) described in `structure.md` are deferred. This spec ships `tombstone.ts`, `zombie.ts`, `ghost.ts` (TODO/skip), and `crypt.ts` (deps).

---

## Requirements

### REQ-1 Public API contract

**REQ-1.1** The scanner exposes a single async entry point, `scanRepo`, in `scanner/index.ts`. Its signature is:

```ts
scanRepo(input: ScanInput): Promise<ScanResult>
```

**REQ-1.2** `ScanInput` is:

```ts
interface ScanInput {
  repoUrl: string;        // e.g. "https://github.com/owner/repo"
  token?: string;         // GitHub personal access token (optional)
}
```

**REQ-1.3** `ScanResult` is:

```ts
interface ScanResult {
  repo: RepoMeta;
  entities: GraveyardEntity[];
  healthScore: number;    // 0–100, integer
  scannedAt: string;      // ISO 8601 timestamp
  truncated: boolean;     // true when the file cap was hit
}
```

**REQ-1.4** `GraveyardEntity` is:

```ts
interface GraveyardEntity {
  id: string;             // stable, deterministic: sha1-like hash of type + ref
  type: "tombstone" | "zombie" | "ghost" | "crypt";
  title: string;          // short human label, e.g. filename or package name
  ref: string;            // file path, branch name, dep name, etc.
  evidence: Evidence[];   // one or more facts proving the finding
  severity: 1 | 2 | 3;   // 1 = minor, 2 = moderate, 3 = critical
  epitaph: string;        // spooky one-liner in the voice from spooky-design.md
  remediation: string;    // plain-language or shell command to fix it
}
```

**REQ-1.5** `Evidence` is:

```ts
interface Evidence {
  label: string;   // human-readable fact name, e.g. "Last commit"
  value: string;   // the actual value, e.g. "2022-11-03"
}
```

---

### REQ-2 Tombstone detector (`scanner/tombstone.ts`)

**REQ-2.1** The detector receives a list of `SourceFile` objects (path + content) and returns `TombstoneFindings[]`.

**REQ-2.2** It builds a simple import graph: for each file, parse all `import` and `require()` statements and collect the set of local paths they reference.

**REQ-2.3** A file is a tombstone candidate if no other scanned file imports it, **and** it is not an entry point, config file, or test file.

- Entry points: `index.ts`, `index.js`, `main.ts`, `main.js`, `app.ts`, `app.js`, plus any file listed as `"main"` or `"exports"` in `package.json`.
- Config files: any file whose name matches `*.config.{ts,js,mjs,cjs}`, `.*rc.{ts,js,json}`, or is located in a `config/` directory at the repo root.
- Test files: any file whose path contains `__tests__`, `.test.`, `.spec.`, or `tests/`.

**REQ-2.4** A named export within a file is a tombstone candidate if the export identifier is never used as an import specifier in any other file. Report each unreferenced export separately when a file has multiple exports and at least one is referenced.

**REQ-2.5** When an entire file is unreferenced, report one entity for the file (not one per export).

**REQ-2.6** Severity: unreferenced file = 2; unreferenced export in an otherwise-referenced file = 1.

**REQ-2.7** Epitaph pattern: `"Here lies {ref} — exported to the world, received by none."`

---

### REQ-3 Zombie detector (`scanner/zombie.ts`)

**REQ-3.1** The detector receives a list of `BranchInfo` and `PullRequestInfo` objects and returns `ZombieFindings[]`.

**REQ-3.2** `BranchInfo`:

```ts
interface BranchInfo {
  name: string;
  lastCommitDate: string;  // ISO 8601
  isDefault: boolean;
}
```

**REQ-3.3** `PullRequestInfo`:

```ts
interface PullRequestInfo {
  number: number;
  title: string;
  state: "open";
  lastActivityDate: string;  // ISO 8601, latest of updatedAt / lastCommitDate
  headRef: string;
}
```

**REQ-3.4** A branch is a zombie if it is not the default branch and its last commit date is 90 or more days before the scan date.

**REQ-3.5** An open PR is a zombie if its last activity date is 90 or more days before the scan date.

**REQ-3.6** When a zombie branch also has a zombie PR, emit one entity for the PR (the branch is implied). Do not double-count.

**REQ-3.7** Severity: 90–179 days = 1; 180–364 days = 2; 365+ days = 3.

**REQ-3.8** Epitaph pattern for branch: `"Here lies branch {ref} — still open after {days} days, going nowhere."` For PR: `"Here lies PR #{number}: "{title}" — abandoned {days} days ago, mid-review."`

---

### REQ-4 Ghost detector (`scanner/ghost.ts`)

**REQ-4.1** The detector receives a list of `SourceFile` objects and returns `GhostFindings[]`.

**REQ-4.2** It scans each file's content for two signals:

- **Deferred comments**: lines containing `TODO`, `FIXME`, or `HACK` (case-insensitive, as a whole token — not inside a URL).
- **Skipped tests**: lines or blocks using `it.skip`, `test.skip`, `xit`, `xdescribe`, `xtest`, or `describe.skip`.

**REQ-4.3** Each unique (file, line number) occurrence is a separate finding if it is a skipped test. For deferred comments, group all occurrences in the same file into one entity (evidence lists the count and up to three sample lines).

**REQ-4.4** Severity:
- Skipped test: 2.
- File with 1–4 deferred comments: 1.
- File with 5+ deferred comments: 2.

**REQ-4.5** Epitaph pattern for deferred comment: `"Here lies {ref} — {count} deferred promises, none kept."` For skipped test: `"Here lies {ref}:{line} — a test that never ran and never will."`

---

### REQ-5 Crypt detector (`scanner/crypt.ts`)

**REQ-5.1** The detector receives `PackageJson` (the parsed contents of `package.json`) and a list of `NpmPackageInfo` objects fetched from the npm registry, and returns `CryptFindings[]`.

**REQ-5.2** `NpmPackageInfo`:

```ts
interface NpmPackageInfo {
  name: string;
  installedVersion: string;    // version string from package.json
  latestVersion: string;       // "version" field from npm registry
  isDeprecated: boolean;       // "deprecated" field present in registry dist-tag
  deprecationMessage?: string;
}
```

**REQ-5.3** A dependency is a crypt candidate if:
- It is marked deprecated in the npm registry, **or**
- Its installed major version is 2 or more behind the latest major version.

**REQ-5.4** Check both `dependencies` and `devDependencies`. Do not check `peerDependencies` or `optionalDependencies`.

**REQ-5.5** Severity: deprecated = 3; 2 major versions behind = 2; 3+ major versions behind = 3.

**REQ-5.6** Epitaph pattern for deprecated: `"Here lies {name}@{version} — the registry itself has given up on it."` For outdated: `"Here lies {name}@{version} — {latestMajor - installedMajor} major versions behind, and counting."`

---

### REQ-6 Health score (`scanner/health.ts`)

**REQ-6.1** The health score is computed from the entity list alone — no raw counts, no external inputs.

**REQ-6.2** Each entity contributes a penalty:

| Severity | Penalty |
|---|---|
| 1 | 2 points |
| 2 | 5 points |
| 3 | 10 points |

**REQ-6.3** `healthScore = Math.max(0, 100 - totalPenalty)`, then clamped to `[0, 100]` as an integer.

**REQ-6.4** An empty entity list always yields a score of 100.

**REQ-6.5** The score must never exceed 100 or fall below 0 regardless of entity count.

---

### REQ-7 GitHub data fetching (`lib/github/`)

**REQ-7.1** All GitHub API calls go through `lib/github/client.ts`. The client accepts an optional token and sets the `Authorization: Bearer` header when present.

**REQ-7.2** The client must respect the `X-RateLimit-Remaining` response header. When remaining hits 0, it must throw a `RateLimitError` with the reset timestamp from `X-RateLimit-Reset` rather than making further requests.

**REQ-7.3** For large repositories, file fetching is capped at **500 files**. Files are prioritised: JS/TS source files first (by path depth, shallowest first), then all others. When the cap is hit, `ScanResult.truncated` is set to `true`.

**REQ-7.4** The fetcher must resolve `repoUrl` to `{owner}/{repo}` and reject — with a typed `InvalidRepoUrlError` — any string that does not match a `github.com/{owner}/{repo}` pattern.

**REQ-7.5** Individual file contents are fetched in parallel with a concurrency limit of 10.

---

### REQ-8 Demo cache (`lib/github/demo-cache.ts`)

**REQ-8.1** Three repositories are pre-cached as static JSON fixtures under `lib/github/fixtures/`. The fixtures contain everything the fetcher normally returns: file list, file contents, branches, PRs, and `package.json`.

**REQ-8.2** The three demo repos are:
- `facebook/react` — large, well-maintained baseline.
- `vercel/next.js` — large, active, with known legacy areas.
- `expressjs/express` — smaller, older, with meaningful debt signals.

**REQ-8.3** Before making any API call, the fetcher checks whether the requested `owner/repo` matches a fixture. If it does, it returns fixture data without hitting the network — regardless of whether a token is supplied.

**REQ-8.4** Fixtures are generated offline and committed. They are not regenerated at runtime.

---

### REQ-9 Output format

**REQ-9.1** `scanRepo` returns a plain JavaScript object (not a class instance, not a Response). It is JSON-serialisable.

**REQ-9.2** Entity `id` values are stable: given the same `type` and `ref`, the same id is produced on every run. Use `sha1(type + ":" + ref)` or equivalent deterministic hash. This allows the UI to track "banished" entities across re-scans of the same repo.

**REQ-9.3** `scannedAt` is set to the wall-clock time at which `scanRepo` was called (before fetching), not after.

---

### REQ-10 Error handling

**REQ-10.1** `scanRepo` never throws for domain errors. It returns a `ScanResult` with an empty entity list and a `healthScore` of 100 when the repo is empty or returns no usable data.

**REQ-10.2** The following errors are thrown (not swallowed) because they represent caller mistakes, not runtime failures:
- `InvalidRepoUrlError` — the URL is not a valid `github.com` repo URL.
- `RepoNotFoundError` — the GitHub API returns 404.
- `RateLimitError` — the rate limit is exhausted (includes reset time).

**REQ-10.3** Each detector function never throws. If given empty, `null`, or structurally malformed input, it returns an empty array.

---

## Out of scope for this feature

- Monorepo support (multiple `package.json` files).
- Languages other than JS and TS.
- Writing any changes back to the repo.
- Caching scan results between sessions.
- Authentication flows — the token is supplied by the caller.

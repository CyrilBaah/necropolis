# Repo Scanner — Design

## Module map

```
scanner/
  index.ts          # scanRepo entry point; orchestrates fetch → detect → score
  tombstone.ts      # dead-code detector
  zombie.ts         # stale branch / PR detector
  ghost.ts          # TODO/FIXME/HACK + skipped-test detector
  crypt.ts          # deprecated / outdated npm dependency detector
  health.ts         # health score computation
  types.ts          # all shared interfaces (ScanInput, ScanResult, GraveyardEntity, …)
  id.ts             # deterministic entity id generation

lib/github/
  client.ts         # HTTP client, auth header, rate-limit guard
  fetcher.ts        # high-level: fetch file tree, file contents, branches, PRs
  demo-cache.ts     # fixture lookup; wraps fetcher
  fixtures/
    facebook-react.json
    vercel-next.json
    expressjs-express.json

tests/
  scanner/
    tombstone.test.ts
    zombie.test.ts
    ghost.test.ts
    crypt.test.ts
    health.test.ts
  lib/
    client.test.ts
    demo-cache.test.ts
```

---

## Data flow

```
caller
  │
  ▼
scanRepo(ScanInput)                         ← scanner/index.ts
  │
  ├─ parse + validate repoUrl               ← throws InvalidRepoUrlError early
  │
  ├─ fetchRepoData(owner, repo, token)      ← lib/github/demo-cache.ts → fetcher.ts
  │     ├─ check fixture cache (REQ-8.3)
  │     ├─ GET /repos/{owner}/{repo}/git/trees?recursive=1   (file tree)
  │     ├─ GET file contents in batches of 10               (REQ-7.5)
  │     │     capped at 500 files, JS/TS first              (REQ-7.3)
  │     ├─ GET /repos/{owner}/{repo}/branches
  │     ├─ GET /repos/{owner}/{repo}/pulls?state=open
  │     └─ parse package.json + fetch npm registry for each dep
  │
  ├─ run detectors (all pure, all in parallel with Promise.all)
  │     ├─ detectTombstones(files)
  │     ├─ detectZombies(branches, pullRequests, now)
  │     ├─ detectGhosts(files)
  │     └─ detectCrypts(packageJson, npmInfos)
  │
  ├─ flatten findings → GraveyardEntity[]   (assign ids, epitaphs, remediations)
  │
  ├─ computeHealthScore(entities)
  │
  └─ return ScanResult
```

---

## Tombstone detector design

The detector does not parse TypeScript with a full AST. It uses regex-based heuristics that are fast, dependency-free, and accurate enough for the signal:

**Import collection:** scan every file for lines matching:
- `import ... from ['"]./...['"]`
- `import ... from ['"]../...['"]`
- `require(['"]./...['"])`
- `require(['"]../...['"])`

Resolve the path relative to the importing file. Normalise extensions: try the literal path first, then append `.ts`, `.tsx`, `.js`, `.jsx`, then try `/index.{ts,tsx,js,jsx}`.

**Export collection:** scan every file for:
- `export function name`
- `export const name`
- `export class name`
- `export default` (treated as a single "default" export)
- `export { a, b, c }` (each specifier)

**Dead-file rule:** a file is dead if its normalised path appears in no other file's import set, and it is not an entry point, config, or test file (REQ-2.3).

**Dead-export rule:** applied only to files that are themselves imported. An export name is dead if it never appears as a specifier in any import statement across the codebase. This is a conservative heuristic: re-exports and namespace imports (`import * as x`) are treated as "references everything" and suppress dead-export detection for that file.

---

## Zombie detector design

Stateless date arithmetic. The detector receives a `now: Date` parameter so it is fully deterministic in tests.

Days-since calculation: `Math.floor((now.getTime() - new Date(lastActivityDate).getTime()) / 86_400_000)`.

The deduplication rule (REQ-3.6): build a Set of `headRef` names from all zombie PRs. When iterating zombie branches, skip any branch whose name is in that set.

---

## Ghost detector design

Two independent passes over each file's lines:

**Pass 1 — deferred comments:**
Match each line against `/\b(TODO|FIXME|HACK)\b/i`, excluding matches inside URLs (`://`). Collect matching lines. Build one entity per file.

**Pass 2 — skipped tests:**
Match each line against:
```
/\b(it\.skip|test\.skip|xit|xtest|xdescribe|describe\.skip)\s*\(/
```
Build one entity per matching line (file + line number).

Both passes run in a single loop over the file's lines for efficiency.

---

## Crypt detector design

**Version comparison:** use a simple major-version parse: `parseInt(semver.split('.')[0].replace(/[^0-9]/g, ''), 10)`. This handles `^1.2.3`, `~1.2.3`, `1.2.3`, `>=1.0.0` by stripping non-numeric prefixes before the first dot. No semver library dependency.

**npm registry fetch** (inside `lib/github/fetcher.ts`, not the detector): `GET https://registry.npmjs.org/{name}/latest`. The detector receives already-fetched `NpmPackageInfo[]`. The fetcher batches registry calls with the same 10-concurrency limit used for file fetching.

**Deprecation signal:** the registry's `latest` dist-tag object contains a `"deprecated"` string field when the package is deprecated. The fetcher sets `isDeprecated: true` and captures `deprecationMessage` when this field is present.

---

## Health score design

`computeHealthScore` in `scanner/health.ts` takes only `GraveyardEntity[]`. It is a pure function with no other dependencies.

```ts
const PENALTY: Record<1 | 2 | 3, number> = { 1: 2, 2: 5, 3: 10 };

export function computeHealthScore(entities: GraveyardEntity[]): number {
  const total = entities.reduce((sum, e) => sum + PENALTY[e.severity], 0);
  return Math.max(0, Math.min(100, 100 - total));
}
```

The score is an integer by construction (all penalties are integers, 100 is an integer, Math.max/min preserve integers).

---

## Rate-limit guard

`client.ts` wraps every fetch response:

```ts
if (response.headers.get("X-RateLimit-Remaining") === "0") {
  const reset = response.headers.get("X-RateLimit-Reset");
  throw new RateLimitError(reset ? new Date(Number(reset) * 1000) : null);
}
```

The check runs before the response body is parsed, so it fires even on a successful-status rate-limited response (GitHub sometimes returns 403 with rate-limit headers, sometimes 200 with remaining = 0 on the last call).

---

## Entity id generation

```ts
// scanner/id.ts
import { createHash } from "crypto";

export function entityId(type: string, ref: string): string {
  return createHash("sha1").update(`${type}:${ref}`).digest("hex").slice(0, 16);
}
```

16 hex characters (64 bits) is sufficient for collision-safety at repo scale. The id is stable across runs given the same type and ref.

---

## Epitaphs and remediations

Epitaphs are built inline in each detector's mapping function (not in a separate template file). The pattern for each type is defined in REQ-2.7, REQ-3.8, REQ-4.5, REQ-5.6. Remediations are plain strings:

| Type | Remediation |
|---|---|
| Tombstone (file) | `git rm {ref}` |
| Tombstone (export) | Remove the `export` keyword from `{ref}` |
| Zombie (branch) | `git push origin --delete {ref}` |
| Zombie (PR) | Close PR #{number} on GitHub |
| Ghost (TODO) | Address or remove the {count} deferred comment(s) in {ref} |
| Ghost (skip) | Remove `.skip` from the test at {ref}:{line}, or delete it |
| Crypt (deprecated) | `npm install {replacement}` or remove `{name}` from package.json |
| Crypt (outdated) | `npm install {name}@latest` |

---

## Demo fixture generation

Fixtures are generated by a one-off script (`scripts/generate-fixtures.ts`) that calls the live GitHub and npm APIs and writes the result to `lib/github/fixtures/`. The script is not part of the production build. Generated files are committed.

Each fixture is a single JSON object matching `RepoData` (the internal type returned by `fetchRepoData`). The scanner's `demo-cache.ts` deserialises and returns it as-is.

---

## File-cap and prioritisation

`fetcher.ts` receives the full file tree from the GitHub Trees API. It then:

1. Separates JS/TS files (`*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs`) from all others.
2. Sorts JS/TS files by path depth (number of `/` characters), ascending.
3. Takes up to 500 files total: JS/TS first, then remaining files to fill the cap.
4. Sets `truncated = true` on the result if the full tree exceeded 500.

---

## Test plan (property-based)

Each detector test file imports from `fast-check` and verifies:

| Property | Detector / function |
|---|---|
| Never throws on empty input array | All four detectors |
| Never throws on `null` or `undefined` input | All four detectors |
| Never throws on structurally malformed objects in array | All four detectors |
| Score is always in `[0, 100]` | `computeHealthScore` |
| Score is 100 for empty entity list | `computeHealthScore` |
| Removing any entity never lowers the score | `computeHealthScore` |
| Adding any severity-1 entity reduces score by exactly 2 (unless already 0) | `computeHealthScore` |
| A file imported by at least one other file is never a tombstone | `detectTombstones` |
| A branch active within 90 days is never a zombie | `detectZombies` |
| A file with no TODO/FIXME/HACK and no skip calls produces no ghost entities | `detectGhosts` |
| A dep at the latest major version is never a crypt (outdated path) | `detectCrypts` |
| Entity ids are stable: same type + ref always produces the same id | `entityId` |
| Entity ids are unique across distinct type+ref pairs (collision resistance at N≤1000) | `entityId` |

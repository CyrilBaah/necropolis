/**
 * Shared types for the Necropolis repo scanner.
 *
 * All interfaces in this file are pure data shapes — no runtime behaviour.
 * They are consumed by the scanner detectors, the GitHub fetcher, and the
 * Next.js API layer.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** The four entity types that can appear in a graveyard. */
export type EntityType = "tombstone" | "zombie" | "ghost" | "crypt";

/** Severity of a finding: 1 = minor, 2 = moderate, 3 = critical. */
export type Severity = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Scanner public API
// ---------------------------------------------------------------------------

/** Input to the top-level scanRepo function. */
export interface ScanInput {
  /** Full GitHub repo URL, e.g. "https://github.com/owner/repo". */
  repoUrl: string;
  /** Optional personal access token to raise the GitHub API rate limit. */
  token?: string;
}

/** A single fact that proves a finding. */
export interface Evidence {
  /** Human-readable label, e.g. "Last commit". */
  label: string;
  /** The concrete value, e.g. "2022-11-03". */
  value: string;
}

/** One piece of tech debt, ready to be rendered as a graveyard entity. */
export interface GraveyardEntity {
  /**
   * Stable, deterministic id. Generated from sha1(type + ":" + ref), 16 hex chars.
   * Identical across runs for the same type + ref, allowing the UI to track
   * "banished" state.
   */
  id: string;
  type: EntityType;
  /** Short human label — filename, package name, branch name, etc. */
  title: string;
  /** The specific thing flagged: file path, branch name, dep name, line ref, etc. */
  ref: string;
  /** One or more facts that prove the finding. */
  evidence: Evidence[];
  severity: Severity;
  /** One-line epitaph in the spooky Victorian undertaker voice. */
  epitaph: string;
  /** Plain-language or shell command to remove the debt. */
  remediation: string;
}

/** The full result of a scan, returned by scanRepo. */
export interface ScanResult {
  repo: RepoMeta;
  entities: GraveyardEntity[];
  /** Integer in [0, 100]. Higher is healthier. */
  healthScore: number;
  /** ISO 8601 timestamp set at the moment scanRepo was called (before fetching). */
  scannedAt: string;
  /**
   * True when the repository exceeded the 500-file cap and was scanned
   * partially. Findings may be incomplete.
   */
  truncated: boolean;
}

/** Metadata about the scanned repository. */
export interface RepoMeta {
  owner: string;
  repo: string;
  /** Canonical URL, e.g. "https://github.com/owner/repo". */
  url: string;
}

// ---------------------------------------------------------------------------
// Detector input types
// ---------------------------------------------------------------------------

/** A source file fetched from the repository. */
export interface SourceFile {
  /** Repo-relative path, e.g. "src/utils/legacy.ts". */
  path: string;
  /** Raw UTF-8 content of the file. */
  content: string;
}

/**
 * Metadata about a branch, used by the Zombie detector.
 * Fetched via GET /repos/{owner}/{repo}/branches.
 */
export interface BranchInfo {
  name: string;
  /** ISO 8601 date of the most recent commit on this branch. */
  lastCommitDate: string;
  /** True for the repository's default branch (usually "main" or "master"). */
  isDefault: boolean;
}

/**
 * Metadata about an open pull request, used by the Zombie detector.
 * Fetched via GET /repos/{owner}/{repo}/pulls?state=open.
 */
export interface PullRequestInfo {
  number: number;
  title: string;
  state: "open";
  /**
   * ISO 8601 date of the most recent activity: the later of updatedAt and
   * the head branch's last commit date.
   */
  lastActivityDate: string;
  /** Name of the head branch, e.g. "feature/old-experiment". */
  headRef: string;
}

/**
 * Loosely typed shape of a parsed package.json.
 * Only the fields the scanner needs are declared; all others are ignored.
 */
export interface PackageJson {
  name?: string;
  main?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * npm registry metadata for a single dependency, used by the Crypt detector.
 * Fetched via GET https://registry.npmjs.org/{name}/latest.
 */
export interface NpmPackageInfo {
  name: string;
  /** Version string as declared in package.json (may include range prefix). */
  installedVersion: string;
  /** The "version" field from the npm registry's latest dist-tag. */
  latestVersion: string;
  /** True when the registry "deprecated" field is present on the package. */
  isDeprecated: boolean;
  /** The deprecation message from the registry, if present. */
  deprecationMessage?: string;
}

// ---------------------------------------------------------------------------
// Internal fetcher aggregate
// ---------------------------------------------------------------------------

/**
 * The raw data bundle returned by fetchRepoData (and the demo cache).
 * This is an internal type — it is not part of the public scanRepo API.
 */
export interface RepoData {
  files: SourceFile[];
  branches: BranchInfo[];
  pullRequests: PullRequestInfo[];
  /** Null when the repository has no package.json or it could not be parsed. */
  packageJson: PackageJson | null;
  npmInfos: NpmPackageInfo[];
  /**
   * True when the file tree exceeded the 500-file cap. Some source files
   * were not fetched; detector results may be incomplete.
   */
  truncated: boolean;
}

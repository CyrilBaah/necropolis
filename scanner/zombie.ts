import type {
  BranchInfo,
  PullRequestInfo,
  GraveyardEntity,
} from "./types.js";
import { entityId } from "./id.js";

/**
 * Detect zombie branches and open PRs: branches or pull requests with no
 * activity for 90 or more days.
 *
 * When a zombie branch also has a zombie PR (the PR's headRef matches the
 * branch name), only one entity is emitted — the PR — to avoid double-counting.
 *
 * Severity scales with staleness:
 * - 90–179 days: severity 1 (minor)
 * - 180–364 days: severity 2 (moderate)
 * - 365+ days:   severity 3 (critical)
 *
 * @param branches - List of repository branches.
 * @param pullRequests - List of open pull requests.
 * @param now - The current time (injected for deterministic testing).
 * @returns Array of zombie entities.
 */
export function detectZombies(
  branches: BranchInfo[],
  pullRequests: PullRequestInfo[],
  now: Date
): GraveyardEntity[] {
  if (!branches && !pullRequests) {
    return [];
  }

  const safeBranches = Array.isArray(branches) ? branches : [];
  const safePRs = Array.isArray(pullRequests) ? pullRequests : [];

  const entities: GraveyardEntity[] = [];

  // --- Pass 1: zombie PRs ---
  // Track which branches are covered by a zombie PR so we don't double-count.
  const branchesCoveredByZombiePR = new Set<string>();

  for (const pr of safePRs) {
    if (!pr || typeof pr !== "object") {
      continue;
    }

    const days = daysSince(pr.lastActivityDate, now);
    if (days < 90) {
      continue;
    }

    branchesCoveredByZombiePR.add(pr.headRef);

    const severity = zombieSeverity(days);

    entities.push({
      id: entityId("zombie", `pr:${pr.number}`),
      type: "zombie",
      title: `PR #${pr.number}: ${pr.title}`,
      ref: `pr:${pr.number}`,
      evidence: [
        { label: "PR number", value: String(pr.number) },
        { label: "Title", value: pr.title },
        { label: "Last activity", value: pr.lastActivityDate },
        { label: "Days inactive", value: String(days) },
        { label: "Head branch", value: pr.headRef },
      ],
      severity,
      epitaph: `Here lies PR #${pr.number}: "${pr.title}" — abandoned ${days} days ago, mid-review.`,
      remediation: `Close PR #${pr.number} on GitHub`,
    });
  }

  // --- Pass 2: zombie branches ---
  // Skip the default branch and any branch already represented by a zombie PR.
  for (const branch of safeBranches) {
    if (!branch || typeof branch !== "object") {
      continue;
    }

    if (branch.isDefault) {
      continue;
    }

    if (branchesCoveredByZombiePR.has(branch.name)) {
      continue;
    }

    const days = daysSince(branch.lastCommitDate, now);
    if (days < 90) {
      continue;
    }

    const severity = zombieSeverity(days);

    entities.push({
      id: entityId("zombie", `branch:${branch.name}`),
      type: "zombie",
      title: branch.name,
      ref: `branch:${branch.name}`,
      evidence: [
        { label: "Branch", value: branch.name },
        { label: "Last commit", value: branch.lastCommitDate },
        { label: "Days inactive", value: String(days) },
      ],
      severity,
      epitaph: `Here lies branch ${branch.name} — still open after ${days} days, going nowhere.`,
      remediation: `git push origin --delete ${branch.name}`,
    });
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute whole days between a date string and `now`.
 * Returns 0 (not negative) if the date is in the future or cannot be parsed.
 */
function daysSince(isoDate: string, now: Date): number {
  if (!isoDate) {
    return 0;
  }
  const then = new Date(isoDate);
  if (isNaN(then.getTime())) {
    return 0;
  }
  return Math.max(
    0,
    Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  );
}

/**
 * Map a staleness in days to a severity level.
 *
 * - 90–179 days → 1 (minor)
 * - 180–364 days → 2 (moderate)
 * - 365+ days → 3 (critical)
 */
function zombieSeverity(days: number): 1 | 2 | 3 {
  if (days >= 365) return 3;
  if (days >= 180) return 2;
  return 1;
}

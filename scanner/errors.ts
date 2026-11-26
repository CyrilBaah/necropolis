/**
 * Typed error classes thrown by the Necropolis scanner.
 *
 * These represent caller mistakes or unrecoverable API failures.
 * Domain-level emptiness (empty repo, no findings) is never an error —
 * scanRepo returns a valid ScanResult with an empty entity list instead.
 */

/**
 * Thrown when the caller supplies a URL that cannot be resolved to a
 * github.com/{owner}/{repo} path.
 *
 * @example
 * throw new InvalidRepoUrlError("not-a-url")
 */
export class InvalidRepoUrlError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(
      `"${url}" is not a valid GitHub repository URL. Expected https://github.com/{owner}/{repo}.`
    );
    this.name = "InvalidRepoUrlError";
    this.url = url;
    // Maintain proper prototype chain in environments that transpile classes.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the GitHub API returns HTTP 404 for the requested repository.
 * The repo may be private, deleted, or the owner/repo pair may be wrong.
 */
export class RepoNotFoundError extends Error {
  readonly owner: string;
  readonly repo: string;

  constructor(owner: string, repo: string) {
    super(
      `Repository "${owner}/${repo}" was not found. It may be private, deleted, or misspelled.`
    );
    this.name = "RepoNotFoundError";
    this.owner = owner;
    this.repo = repo;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the GitHub API rate limit is exhausted (X-RateLimit-Remaining = 0).
 * Supply a token via ScanInput.token to raise the limit from 60 to 5,000 requests/hour.
 *
 * @param resetAt - The Date at which the rate limit resets, or null if unknown.
 */
export class RateLimitError extends Error {
  /** When the rate limit resets. Null if the reset time could not be determined. */
  readonly resetAt: Date | null;

  constructor(resetAt: Date | null) {
    const resetMsg =
      resetAt != null
        ? ` Rate limit resets at ${resetAt.toISOString()}.`
        : "";
    super(
      `GitHub API rate limit exhausted.${resetMsg} Supply a personal access token to raise the limit.`
    );
    this.name = "RateLimitError";
    this.resetAt = resetAt;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

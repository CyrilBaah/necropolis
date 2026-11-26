import { RateLimitError, RepoNotFoundError } from "../../scanner/errors.js";

/**
 * Make an authenticated GET request to the GitHub REST API.
 *
 * - Sets `Accept: application/vnd.github+json` on every request.
 * - Sets `Authorization: Bearer {token}` when a token is provided.
 * - Checks `X-RateLimit-Remaining` before reading the response body.
 *   Throws `RateLimitError` immediately when the header is "0".
 * - Throws `RepoNotFoundError` on HTTP 404.
 * - Returns parsed JSON for any 2xx response.
 * - Throws a plain `Error` for any other non-OK status.
 *
 * @param path - Absolute GitHub API path, e.g. "/repos/owner/repo/branches".
 * @param token - Optional personal access token.
 * @returns Parsed JSON response body.
 *
 * @throws {RateLimitError} When `X-RateLimit-Remaining` is "0".
 * @throws {RepoNotFoundError} When the API returns HTTP 404.
 * @throws {Error} For any other non-OK HTTP status.
 */
export async function githubGet(
  path: string,
  token?: string
): Promise<unknown> {
  const url = `https://api.github.com${path}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  // Rate-limit check runs before reading the body (REQ-7.2).
  // GitHub can return 200 with remaining = 0 on the very last allowed call,
  // or 403 with remaining = 0 when the limit is already exhausted.
  if (response.headers.get("X-RateLimit-Remaining") === "0") {
    const resetHeader = response.headers.get("X-RateLimit-Reset");
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000)
      : null;
    throw new RateLimitError(resetAt);
  }

  if (response.status === 404) {
    throw new RepoNotFoundError("unknown", "unknown");
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText} (${url})`
    );
  }

  return response.json();
}

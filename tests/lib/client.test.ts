import { describe, it, expect, vi, afterEach } from "vitest";
import { githubGet } from "../../lib/github/client.js";
import { RateLimitError, RepoNotFoundError } from "../../scanner/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response-like mock.
 * Vitest runs in Node; we fake just the fields githubGet reads.
 */
function makeFetch(opts: {
  status: number;
  ok: boolean;
  headers?: Record<string, string | null>;
  body?: unknown;
}) {
  const headers = new Map<string, string | null>(
    Object.entries(opts.headers ?? {})
  );
  return vi.fn().mockResolvedValue({
    status: opts.status,
    ok: opts.ok,
    statusText: String(opts.status),
    headers: {
      get: (key: string) => headers.get(key) ?? null,
    },
    json: () => Promise.resolve(opts.body ?? {}),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Authorization header
// ---------------------------------------------------------------------------

describe("githubGet — authorization", () => {
  it("sets Authorization header when a token is provided", async () => {
    const mockFetch = makeFetch({ status: 200, ok: true, body: { ok: true } });
    vi.stubGlobal("fetch", mockFetch);

    await githubGet("/repos/owner/repo", "my-token");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });

  it("does not set Authorization header when no token is provided", async () => {
    const mockFetch = makeFetch({ status: 200, ok: true, body: { ok: true } });
    vi.stubGlobal("fetch", mockFetch);

    await githubGet("/repos/owner/repo");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("always sets the Accept header", async () => {
    const mockFetch = makeFetch({ status: 200, ok: true, body: {} });
    vi.stubGlobal("fetch", mockFetch);

    await githubGet("/repos/owner/repo");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/vnd.github+json");
  });
});

// ---------------------------------------------------------------------------
// Rate-limit guard
// ---------------------------------------------------------------------------

describe("githubGet — rate limit", () => {
  it("throws RateLimitError when X-RateLimit-Remaining is 0", async () => {
    const resetUnix = Math.floor(Date.now() / 1000) + 3600;
    const mockFetch = makeFetch({
      status: 200,
      ok: true,
      headers: {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetUnix),
      },
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubGet("/repos/owner/repo")).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  it("RateLimitError includes the reset time", async () => {
    const resetUnix = 1700000000;
    const mockFetch = makeFetch({
      status: 200,
      ok: true,
      headers: {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetUnix),
      },
    });
    vi.stubGlobal("fetch", mockFetch);

    try {
      await githubGet("/repos/owner/repo");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rateLimitErr = err as RateLimitError;
      expect(rateLimitErr.resetAt).toBeInstanceOf(Date);
      expect(rateLimitErr.resetAt!.getTime()).toBe(resetUnix * 1000);
    }
  });

  it("RateLimitError.resetAt is null when the reset header is missing", async () => {
    const mockFetch = makeFetch({
      status: 403,
      ok: false,
      headers: {
        "X-RateLimit-Remaining": "0",
      },
    });
    vi.stubGlobal("fetch", mockFetch);

    try {
      await githubGet("/repos/owner/repo");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).resetAt).toBeNull();
    }
  });

  it("throws RateLimitError even on a 403 response when remaining = 0", async () => {
    const mockFetch = makeFetch({
      status: 403,
      ok: false,
      headers: { "X-RateLimit-Remaining": "0" },
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubGet("/repos/owner/repo")).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  it("does not throw RateLimitError when remaining > 0", async () => {
    const mockFetch = makeFetch({
      status: 200,
      ok: true,
      headers: { "X-RateLimit-Remaining": "59" },
      body: { result: "ok" },
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubGet("/repos/owner/repo")).resolves.toEqual({
      result: "ok",
    });
  });
});

// ---------------------------------------------------------------------------
// 404 handling
// ---------------------------------------------------------------------------

describe("githubGet — 404", () => {
  it("throws RepoNotFoundError on HTTP 404", async () => {
    const mockFetch = makeFetch({ status: 404, ok: false });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubGet("/repos/owner/repo")).rejects.toBeInstanceOf(
      RepoNotFoundError
    );
  });

  it("does not throw RepoNotFoundError on 200", async () => {
    const mockFetch = makeFetch({ status: 200, ok: true, body: {} });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubGet("/repos/owner/repo")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// General error handling
// ---------------------------------------------------------------------------

describe("githubGet — other errors", () => {
  it("throws a plain Error for non-OK, non-404 responses", async () => {
    const mockFetch = makeFetch({ status: 500, ok: false });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubGet("/repos/owner/repo")).rejects.toThrow(
      /GitHub API request failed/
    );
  });

  it("returns parsed JSON on a 200 response", async () => {
    const body = { id: 1, name: "test-repo" };
    const mockFetch = makeFetch({ status: 200, ok: true, body });
    vi.stubGlobal("fetch", mockFetch);

    const result = await githubGet("/repos/owner/repo");
    expect(result).toEqual(body);
  });

  it("builds the correct URL from the path", async () => {
    const mockFetch = makeFetch({ status: 200, ok: true, body: {} });
    vi.stubGlobal("fetch", mockFetch);

    await githubGet("/repos/owner/repo/branches");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/owner/repo/branches");
  });
});

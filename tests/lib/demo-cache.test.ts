import { describe, it, expect, vi } from "vitest";
import { fetchRepoDataWithCache } from "../../lib/github/demo-cache.js";
import * as fetcher from "../../lib/github/fetcher.js";

describe("fetchRepoDataWithCache", () => {
  it("returns fixture data for facebook/react without calling fetchRepoData", async () => {
    const spy = vi.spyOn(fetcher, "fetchRepoData");

    const result = await fetchRepoDataWithCache("facebook", "react");

    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns fixture data for vercel/next.js", async () => {
    const spy = vi.spyOn(fetcher, "fetchRepoData");

    const result = await fetchRepoDataWithCache("vercel", "next.js");

    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("returns fixture data for expressjs/express", async () => {
    const spy = vi.spyOn(fetcher, "fetchRepoData");

    const result = await fetchRepoDataWithCache("expressjs", "express");

    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("is case-insensitive on owner/repo", async () => {
    const spy = vi.spyOn(fetcher, "fetchRepoData");

    const result = await fetchRepoDataWithCache("Facebook", "React");

    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("delegates to fetchRepoData for an unknown repo", async () => {
    const spy = vi.spyOn(fetcher, "fetchRepoData").mockResolvedValue({
      files: [],
      branches: [],
      pullRequests: [],
      packageJson: null,
      npmInfos: [],
      truncated: false,
    });

    const result = await fetchRepoDataWithCache("unknown", "repo");

    expect(spy).toHaveBeenCalledWith("unknown", "repo", undefined);
    expect(result).toBeDefined();
  });
});

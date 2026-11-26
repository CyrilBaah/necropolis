import { describe, it, expect } from "vitest";
import { scanRepo } from "../../scanner/index.js";
import { InvalidRepoUrlError } from "../../scanner/errors.js";

describe("scanRepo", () => {
  it("resolves for a demo repo (facebook/react) without hitting the network", async () => {
    const result = await scanRepo({ repoUrl: "https://github.com/facebook/react" });
    expect(result).toBeDefined();
    expect(result.repo.owner).toBe("facebook");
    expect(result.repo.repo).toBe("react");
    expect(result.healthScore).toBe(100);
    expect(result.entities).toEqual([]);
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
  });

  it("throws InvalidRepoUrlError for a malformed URL", async () => {
    await expect(scanRepo({ repoUrl: "not-a-url" })).rejects.toThrow(
      InvalidRepoUrlError
    );
  });

  it("throws InvalidRepoUrlError when the URL is not from github.com", async () => {
    await expect(
      scanRepo({ repoUrl: "https://gitlab.com/owner/repo" })
    ).rejects.toThrow(InvalidRepoUrlError);
  });

  it("sets scannedAt before fetching begins", async () => {
    const before = new Date();
    const result = await scanRepo({ repoUrl: "https://github.com/facebook/react" });
    const scannedTime = new Date(result.scannedAt);
    const after = new Date();
    // scannedAt should be very close to the start of the call (not the end)
    expect(scannedTime.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(scannedTime.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("accepts a URL without a leading protocol", async () => {
    const result = await scanRepo({ repoUrl: "github.com/facebook/react" });
    expect(result.repo.owner).toBe("facebook");
    expect(result.repo.repo).toBe("react");
  });

  it("strips .git suffix from the repo name", async () => {
    const result = await scanRepo({
      repoUrl: "https://github.com/facebook/react.git",
    });
    expect(result.repo.repo).toBe("react");
  });
});

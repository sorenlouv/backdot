import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:https", () => ({
  default: { get: vi.fn() },
}));

import https from "node:https";
import { toHttpsUrl, checkRepoVisibility } from "./repoVisibility.js";

describe("toHttpsUrl", () => {
  it("converts GitHub SSH URL", () => {
    expect(toHttpsUrl("git@github.com:user/repo.git")).toBe("https://github.com/user/repo.git");
  });

  it("converts GitLab SSH URL", () => {
    expect(toHttpsUrl("git@gitlab.com:org/project.git")).toBe("https://gitlab.com/org/project.git");
  });

  it("converts Bitbucket SSH URL", () => {
    expect(toHttpsUrl("git@bitbucket.org:team/repo.git")).toBe(
      "https://bitbucket.org/team/repo.git",
    );
  });

  it("converts GitHub HTTPS URL (already HTTPS)", () => {
    expect(toHttpsUrl("https://github.com/user/repo.git")).toBe("https://github.com/user/repo.git");
  });

  it("appends .git if missing", () => {
    expect(toHttpsUrl("git@github.com:user/repo")).toBe("https://github.com/user/repo.git");
  });

  it("converts ssh:// protocol URLs", () => {
    expect(toHttpsUrl("ssh://git@gitlab.com/org/project.git")).toBe(
      "https://gitlab.com/org/project.git",
    );
  });

  it("strips embedded credentials from HTTPS URLs", () => {
    expect(toHttpsUrl("https://user:pass@github.com/user/repo.git")).toBe(
      "https://github.com/user/repo.git",
    );
  });

  it("returns null for unknown hosts", () => {
    expect(toHttpsUrl("git@selfhosted.example.com:user/repo.git")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(toHttpsUrl("not-a-url")).toBeNull();
  });
});

describe("checkRepoVisibility", () => {
  const mockedGet = vi.mocked(https.get);

  type ResponseCallback = (response: { statusCode?: number; resume: () => void }) => void;
  interface FakeRequest {
    on(event: string, handler: (error: Error) => void): FakeRequest;
    destroy(error?: Error): void;
  }

  // Resolve the probe with an HTTP status code (empty body).
  function respondWithStatus(statusCode: number) {
    mockedGet.mockImplementation(((_url: string, _options: unknown, callback: ResponseCallback) => {
      callback({ statusCode, resume: () => {} });
      const request: FakeRequest = { on: () => request, destroy: () => {} };
      return request;
    }) as unknown as typeof https.get);
  }

  // Reject the probe with a connection-level error (the response callback never fires).
  function failWith(error: Error) {
    mockedGet.mockImplementation((() => {
      const request: FakeRequest = {
        on(event, handler) {
          if (event === "error") {
            handler(error);
          }
          return request;
        },
        destroy: () => {},
      };
      return request;
    }) as unknown as typeof https.get);
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns "public" when the refs endpoint answers 200', async () => {
    respondWithStatus(200);

    const result = await checkRepoVisibility("git@github.com:user/repo.git");
    expect(result).toBe("public");

    expect(mockedGet).toHaveBeenCalledWith(
      "https://github.com/user/repo.git/info/refs?service=git-upload-pack",
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function),
    );
  });

  it.each([401, 403, 404])(
    'returns "private" when the refs endpoint answers %i',
    async (status) => {
      respondWithStatus(status);
      expect(await checkRepoVisibility("git@github.com:user/private-repo.git")).toBe("private");
    },
  );

  it('returns "unverifiable" for an unexpected status (e.g. 500)', async () => {
    respondWithStatus(500);
    expect(await checkRepoVisibility("git@gitlab.com:org/repo.git")).toBe("unverifiable");
  });

  it('returns "unverifiable" (not "private") when the request fails to connect', async () => {
    failWith(Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" }));
    expect(await checkRepoVisibility("git@github.com:user/repo.git")).toBe("unverifiable");
  });

  it('returns "unknown" for unrecognized hosts without probing', async () => {
    const result = await checkRepoVisibility("git@selfhosted.example.com:user/repo.git");
    expect(result).toBe("unknown");
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("probes a credential-free URL and sends no Authorization header", async () => {
    respondWithStatus(200);
    await checkRepoVisibility("https://user:pass@github.com/user/repo.git");

    const [url, options] = mockedGet.mock.calls[0];
    expect(url).toBe("https://github.com/user/repo.git/info/refs?service=git-upload-pack");
    const headers = (options as { headers?: Record<string, string> }).headers ?? {};
    expect(Object.keys(headers).map((header) => header.toLowerCase())).not.toContain(
      "authorization",
    );
  });
});

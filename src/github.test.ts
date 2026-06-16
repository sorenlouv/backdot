import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

import fs from "node:fs";
import {
  parseGitHubRepoUrl,
  isGitHubRepoUrl,
  commitUrl,
  gitAuthConfig,
  fetchRepoAccess,
  readTokenFile,
  resolveGitHubToken,
} from "./github.js";
import { TOKEN_FILE_PATH } from "./paths.js";

describe("parseGitHubRepoUrl / isGitHubRepoUrl", () => {
  describe("accepts valid github HTTPS URLs", () => {
    it("plain https://github.com/owner/repo", () => {
      expect(parseGitHubRepoUrl("https://github.com/owner/repo")).toEqual({
        owner: "owner",
        repo: "repo",
      });
      expect(isGitHubRepoUrl("https://github.com/owner/repo")).toBe(true);
    });

    it("with .git suffix", () => {
      expect(parseGitHubRepoUrl("https://github.com/owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
      expect(isGitHubRepoUrl("https://github.com/owner/repo.git")).toBe(true);
    });

    it("with trailing slash", () => {
      expect(parseGitHubRepoUrl("https://github.com/owner/repo/")).toEqual({
        owner: "owner",
        repo: "repo",
      });
      expect(isGitHubRepoUrl("https://github.com/owner/repo/")).toBe(true);
    });

    it("with .git suffix and trailing slash", () => {
      expect(parseGitHubRepoUrl("https://github.com/owner/repo.git/")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("is case-insensitive on the scheme/host", () => {
      expect(parseGitHubRepoUrl("HTTPS://GitHub.com/owner/repo")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("allows dots, underscores, and hyphens in owner/repo names", () => {
      expect(parseGitHubRepoUrl("https://github.com/my-org/my.cool_repo-2")).toEqual({
        owner: "my-org",
        repo: "my.cool_repo-2",
      });
    });
  });

  describe("rejects everything else", () => {
    const rejected = [
      "git@github.com:owner/repo.git",
      "ssh://git@github.com/owner/repo",
      "https://gitlab.com/owner/repo",
      "https://bitbucket.org/owner/repo",
      "http://github.com/owner/repo",
      "https://user:tok@github.com/owner/repo",
      "https://github.com/owner",
      "https://github.com/owner/repo/extra",
      "https://github.com/owner/repo?x=1",
      "https://github.com/owner/repo#frag",
      "https://github.com/owner/repo@ref",
      "https://github.com.evil.com/owner/repo",
      "https://github.com/",
      "github.com/owner/repo",
      "owner/repo",
      "just-a-string",
      "",
    ];

    for (const url of rejected) {
      it(`rejects ${JSON.stringify(url)}`, () => {
        expect(parseGitHubRepoUrl(url)).toBeNull();
        expect(isGitHubRepoUrl(url)).toBe(false);
      });
    }
  });
});

describe("commitUrl", () => {
  it("returns the commit URL for a valid github repo URL", () => {
    expect(commitUrl("https://github.com/owner/repo", "abc123")).toBe(
      "https://github.com/owner/repo/commit/abc123",
    );
  });

  it("strips the .git suffix when building the commit URL", () => {
    expect(commitUrl("https://github.com/owner/repo.git", "deadbeef")).toBe(
      "https://github.com/owner/repo/commit/deadbeef",
    );
  });

  it("returns null for an invalid (non-github / SSH) URL", () => {
    expect(commitUrl("git@github.com:owner/repo.git", "abc123")).toBeNull();
    expect(commitUrl("https://gitlab.com/owner/repo", "abc123")).toBeNull();
    expect(commitUrl("not-a-url", "abc123")).toBeNull();
  });
});

describe("gitAuthConfig", () => {
  it("returns exactly one extraHeader entry with a base64 basic credential", () => {
    const token = "TESTTOKEN";
    const expectedBasic = Buffer.from(`x-access-token:${token}`).toString("base64");
    expect(gitAuthConfig(token)).toEqual([
      `http.https://github.com/.extraHeader=AUTHORIZATION: basic ${expectedBasic}`,
    ]);
  });
});

describe("fetchRepoAccess", () => {
  const repo = { owner: "owner", repo: "repo" };
  const token = "TESTTOKEN";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.BACKDOT_GITHUB_API;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BACKDOT_GITHUB_API;
  });

  function mockResponse({ status = 200, body = {} }: { status?: number; body?: unknown }) {
    vi.mocked(fetch).mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as Response);
  }

  it("returns { isPrivate: true } for a 200 with private:true", async () => {
    mockResponse({ status: 200, body: { private: true } });
    await expect(fetchRepoAccess(repo, token)).resolves.toEqual({
      isPrivate: true,
    });
  });

  it("returns { isPrivate: false } for a 200 with private:false", async () => {
    mockResponse({ status: 200, body: { private: false } });
    await expect(fetchRepoAccess(repo, token)).resolves.toEqual({
      isPrivate: false,
    });
  });

  it("fails closed: 200 with no private field => { isPrivate: false }", async () => {
    mockResponse({ status: 200, body: {} });
    await expect(fetchRepoAccess(repo, token)).resolves.toEqual({
      isPrivate: false,
    });
  });

  it("hits /repos/<owner>/<repo> with a Bearer Authorization header", async () => {
    mockResponse({ status: 200, body: { private: true } });
    await fetchRepoAccess(repo, token);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/owner/repo");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });

  it("respects the BACKDOT_GITHUB_API override", async () => {
    process.env.BACKDOT_GITHUB_API = "http://localhost:9999";
    mockResponse({ status: 200, body: { private: true } });
    await fetchRepoAccess(repo, token);

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://localhost:9999/repos/owner/repo");
  });

  it("throws on 401", async () => {
    mockResponse({ status: 401 });
    await expect(fetchRepoAccess(repo, token)).rejects.toThrow();
  });

  it("throws on 403", async () => {
    mockResponse({ status: 403 });
    await expect(fetchRepoAccess(repo, token)).rejects.toThrow();
  });

  it("throws on 404", async () => {
    mockResponse({ status: 404 });
    await expect(fetchRepoAccess(repo, token)).rejects.toThrow();
  });

  it("throws on an unexpected non-ok status (e.g. 500)", async () => {
    mockResponse({ status: 500 });
    await expect(fetchRepoAccess(repo, token)).rejects.toThrow();
  });

  it("throws when fetch rejects (network failure)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchRepoAccess(repo, token)).rejects.toThrow();
  });
});

describe("readTokenFile / resolveGitHubToken", () => {
  const originalPlatform = process.platform;
  let savedEnvToken: string | undefined;

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  }

  beforeEach(() => {
    savedEnvToken = process.env.BACKDOT_GITHUB_TOKEN;
    delete process.env.BACKDOT_GITHUB_TOKEN;
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  afterEach(() => {
    if (savedEnvToken === undefined) {
      delete process.env.BACKDOT_GITHUB_TOKEN;
    } else {
      process.env.BACKDOT_GITHUB_TOKEN = savedEnvToken;
    }
    setPlatform(originalPlatform);
  });

  describe("readTokenFile", () => {
    it("returns null when the token file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(readTokenFile()).toBeNull();
    });

    it("returns trimmed file contents when present with safe perms (non-win32)", () => {
      setPlatform("linux");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue("  filetoken\n");
      expect(readTokenFile()).toBe("filetoken");
    });

    it("throws on an overly permissive (group/other-readable) mode on non-win32", () => {
      setPlatform("linux");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o644 } as fs.Stats);
      expect(() => readTokenFile()).toThrow(/overly permissive/);
    });

    it("does not check permissions on win32", () => {
      setPlatform("win32");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("wintoken\n");
      expect(readTokenFile()).toBe("wintoken");
      expect(fs.statSync).not.toHaveBeenCalled();
    });
  });

  describe("resolveGitHubToken", () => {
    it("returns the trimmed env token when BACKDOT_GITHUB_TOKEN is set", () => {
      process.env.BACKDOT_GITHUB_TOKEN = "  envtoken  ";
      expect(resolveGitHubToken()).toBe("envtoken");
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it("falls back to the token file when the env var is absent", () => {
      setPlatform("linux");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue("filetoken\n");
      expect(resolveGitHubToken()).toBe("filetoken");
    });

    it("throws when neither the env var nor the token file is present", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => resolveGitHubToken()).toThrow();
    });

    it("references the token file path in the not-found error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => resolveGitHubToken()).toThrow(
        new RegExp(TOKEN_FILE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CleanOptions } from "simple-git";
import { gitAuthConfig } from "./github.js";

const mockGit = {
  init: vi.fn().mockResolvedValue(undefined),
  addRemote: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue(undefined),
  status: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn().mockResolvedValue(undefined),
  revparse: vi.fn().mockResolvedValue("main"),
  reset: vi.fn().mockResolvedValue(undefined),
  clean: vi.fn().mockResolvedValue(undefined),
  clone: vi.fn().mockResolvedValue(undefined),
  remote: vi.fn().mockResolvedValue("https://github.com/user/repo.git"),
  rebase: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue({ all: [] }),
};

// Captures the args of every simpleGit(...) call so tests can assert how the
// instance was constructed (e.g. that the auth config was passed). simpleGit
// may be called as simpleGit(baseDir, options) or simpleGit(options); both
// return the same mockGit.
const simpleGitCalls: unknown[][] = [];

vi.mock("simple-git", () => ({
  simpleGit: vi.fn((...args: unknown[]) => {
    simpleGitCalls.push(args);
    return mockGit;
  }),
  CleanOptions: { FORCE: "f" },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./paths.js", () => ({
  STAGING_DIR: "/mock/staging",
  STAGING_GIT_DIR: "/mock/staging/.git",
}));

import fs from "node:fs";
import {
  gitPull,
  gitCommitAndPush,
  gitLog,
  buildCommitMessage,
  ensureRemoteUrl,
  friendlyGitError,
  gitError,
} from "./git.js";

const TOKEN = "test-token";

// Finds the options object from the captured simpleGit(...) calls, regardless
// of whether it was called as simpleGit(baseDir, options) or simpleGit(options).
function lastSimpleGitOptions(): { config?: string[] } | undefined {
  for (let i = simpleGitCalls.length - 1; i >= 0; i--) {
    const args = simpleGitCalls[i];
    const candidate = args.length === 2 ? args[1] : args[0];
    if (candidate && typeof candidate === "object") {
      return candidate as { config?: string[] };
    }
  }
  return undefined;
}

beforeEach(() => {
  simpleGitCalls.length = 0;
});

describe("ensureRemoteUrl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when URL already matches", async () => {
    mockGit.remote.mockResolvedValue("https://github.com/test/repo.git\n");

    await ensureRemoteUrl("https://github.com/test/repo.git");

    expect(mockGit.remote).toHaveBeenCalledWith(["get-url", "origin"]);
    expect(mockGit.remote).toHaveBeenCalledTimes(1);
  });

  it("updates remote URL when it differs", async () => {
    mockGit.remote.mockResolvedValueOnce("https://github.com/old/repo.git\n");
    mockGit.remote.mockResolvedValueOnce(undefined);

    await ensureRemoteUrl("https://github.com/new/repo.git");

    expect(mockGit.remote).toHaveBeenCalledWith(["get-url", "origin"]);
    expect(mockGit.remote).toHaveBeenCalledWith([
      "set-url",
      "origin",
      "https://github.com/new/repo.git",
    ]);
  });
});

describe("friendlyGitError", () => {
  const repo = "https://github.com/test/repo.git";

  it("returns friendly message for repository not found", () => {
    const raw =
      "remote: Repository not found.\nfatal: repository 'https://github.com/test/repo/' not found";
    expect(friendlyGitError(raw, repo)).toBe(
      `Repository "${repo}" not found, or your GitHub token can't access it.\n` +
        "  Check the URL, and that the token has access to this repository.",
    );
  });

  it("returns friendly message for 'does not exist'", () => {
    expect(friendlyGitError(`fatal: repository '${repo}' does not exist`, repo)).toBe(
      `Repository "${repo}" not found, or your GitHub token can't access it.\n` +
        "  Check the URL, and that the token has access to this repository.",
    );
  });

  it("returns friendly message for 'does not appear to be a git repository'", () => {
    expect(friendlyGitError(`fatal: '${repo}' does not appear to be a git repository`, repo)).toBe(
      `Repository "${repo}" not found, or your GitHub token can't access it.\n` +
        "  Check the URL, and that the token has access to this repository.",
    );
  });

  it("returns friendly message for authentication failure", () => {
    expect(friendlyGitError("Authentication failed for 'https://github.com/x/y.git'", repo)).toBe(
      `Authentication failed for "${repo}". Check your GitHub token.`,
    );
  });

  it("returns friendly message for username prompt failure", () => {
    expect(
      friendlyGitError(
        "could not read Username for 'https://github.com': terminal prompts disabled",
        repo,
      ),
    ).toBe(`Authentication failed for "${repo}". Check your GitHub token.`);
  });

  it("returns friendly message for host resolution failure", () => {
    expect(
      friendlyGitError("fatal: unable to access: Could not resolve host: github.com", repo),
    ).toBe("Could not connect to remote host. Check your internet connection.");
  });

  it("returns friendly message for connection refused", () => {
    expect(friendlyGitError("Failed to connect: Connection refused", repo)).toBe(
      "Could not connect to remote host. Check your internet connection.",
    );
  });

  it("returns friendly message for connection timed out", () => {
    expect(friendlyGitError("Connection timed out", repo)).toBe(
      "Could not connect to remote host. Check your internet connection.",
    );
  });

  it("passes through unknown errors unchanged", () => {
    const raw = "some unexpected git error";
    expect(friendlyGitError(raw, repo)).toBe(raw);
  });
});

describe("gitError", () => {
  const repo = "https://github.com/test/repo.git";

  it("wraps an Error with a friendly message and preserves cause", () => {
    const original = new Error("remote: Repository not found.");
    const wrapped = gitError(original, repo);
    expect(wrapped.message).toContain("not found, or your GitHub token can't access it");
    expect(wrapped.cause).toBe(original);
  });

  it("handles non-Error values", () => {
    const wrapped = gitError("Connection refused", repo);
    expect(wrapped.message).toBe(
      "Could not connect to remote host. Check your internet connection.",
    );
  });
});

describe("gitPull", () => {
  const repo = "https://github.com/test/repo.git";

  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");
    mockGit.reset.mockResolvedValue(undefined);
    mockGit.clean.mockResolvedValue(undefined);
    mockGit.clone.mockResolvedValue(undefined);
    mockGit.init.mockResolvedValue(undefined);
    mockGit.addRemote.mockResolvedValue(undefined);
    mockGit.remote.mockResolvedValue("https://github.com/test/repo.git\n");
  });

  it("fetches and hard resets when .git exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await gitPull(repo, TOKEN);

    expect(mockGit.fetch).toHaveBeenCalledWith("origin");
    expect(mockGit.reset).toHaveBeenCalledWith(["--hard", "origin/main"]);
    expect(mockGit.clean).toHaveBeenCalledWith(CleanOptions.FORCE, ["-d"]);
  });

  it("constructs simpleGit with the auth config", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await gitPull(repo, TOKEN);

    expect(lastSimpleGitOptions()).toEqual({ config: gitAuthConfig(TOKEN) });
  });

  it("clones when .git does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await gitPull(repo, TOKEN);

    expect(mockGit.clone).toHaveBeenCalledWith(repo, "/mock/staging");
  });

  it("falls back to init when clone fails (empty remote)", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockGit.clone.mockRejectedValue(new Error("empty repository"));

    await gitPull(repo, TOKEN);

    expect(fs.mkdirSync).toHaveBeenCalledWith("/mock/staging", { recursive: true });
    expect(mockGit.init).toHaveBeenCalled();
    expect(mockGit.addRemote).toHaveBeenCalledWith("origin", repo);
  });

  it("re-throws non-empty-repo clone errors with friendly message", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockGit.clone.mockRejectedValue(new Error("Could not resolve host: github.com"));

    await expect(gitPull(repo, TOKEN)).rejects.toThrow(
      "Could not connect to remote host. Check your internet connection.",
    );

    expect(mockGit.init).not.toHaveBeenCalled();
  });

  it("re-throws fetch errors with friendly message when .git exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockRejectedValue(
      new Error("remote: Repository not found.\nfatal: repository not found"),
    );

    await expect(gitPull(repo, TOKEN)).rejects.toThrow(
      `Repository "${repo}" not found, or your GitHub token can't access it.`,
    );
  });

  it("resets to a specific commit when commit parameter is provided", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await gitPull(repo, TOKEN, "abc1234");

    expect(mockGit.fetch).toHaveBeenCalledWith("origin");
    expect(mockGit.revparse).not.toHaveBeenCalled();
    expect(mockGit.reset).toHaveBeenCalledWith(["--hard", "abc1234"]);
    expect(mockGit.clean).toHaveBeenCalledWith(CleanOptions.FORCE, ["-d"]);
  });

  it("resets to commit after cloning when commit parameter is provided", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await gitPull(repo, TOKEN, "abc1234");

    expect(mockGit.clone).toHaveBeenCalledWith(repo, "/mock/staging");
    expect(mockGit.reset).toHaveBeenCalledWith(["--hard", "abc1234"]);
    expect(mockGit.clean).toHaveBeenCalledWith(CleanOptions.FORCE, ["-d"]);
  });
});

describe("gitCommitAndPush", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.add.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue(undefined);
    mockGit.push.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("abc1234");
    mockGit.remote.mockResolvedValue("https://github.com/user/repo.git");
  });

  const dirtyStatus = {
    isClean: () => false,
    created: [],
    deleted: [],
    modified: ["machine/.zshrc"],
    renamed: [],
  };

  it("creates and pushes an empty commit when status is clean", async () => {
    mockGit.status.mockResolvedValue({
      isClean: () => true,
      created: [],
      deleted: [],
      modified: [],
      renamed: [],
    });

    const result = await gitCommitAndPush(TOKEN);

    expect(mockGit.add).toHaveBeenCalledWith(".");
    expect(mockGit.commit).toHaveBeenCalledWith("backup: no changes", {
      "--allow-empty": null,
    });
    expect(mockGit.push).toHaveBeenCalledWith(["-u", "origin", "HEAD"]);
    expect(result).toEqual({
      commitUrl: "https://github.com/user/repo/commit/abc1234",
    });
  });

  it("constructs simpleGit with the auth config", async () => {
    mockGit.status.mockResolvedValue(dirtyStatus);

    await gitCommitAndPush(TOKEN);

    expect(lastSimpleGitOptions()).toEqual({ config: gitAuthConfig(TOKEN) });
  });

  it("commits, pushes, and returns commit URL", async () => {
    mockGit.status.mockResolvedValue(dirtyStatus);

    const result = await gitCommitAndPush(TOKEN);

    expect(mockGit.commit).toHaveBeenCalledWith("modified: .zshrc", {
      "--allow-empty": null,
    });
    expect(mockGit.push).toHaveBeenCalledWith(["-u", "origin", "HEAD"]);
    expect(result).toEqual({
      commitUrl: "https://github.com/user/repo/commit/abc1234",
    });
  });

  it("wraps push errors with friendly message", async () => {
    mockGit.status.mockResolvedValue(dirtyStatus);
    const notFoundError = new Error("remote: Repository not found.\nfatal: repository not found");
    mockGit.push.mockRejectedValue(notFoundError);
    mockGit.fetch.mockRejectedValue(notFoundError);

    await expect(gitCommitAndPush(TOKEN)).rejects.toThrow(
      `Repository "https://github.com/user/repo.git" not found, or your GitHub token can't access it.`,
    );
  });
});

describe("gitLog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns formatted commit entries", async () => {
    mockGit.log.mockResolvedValue({
      all: [
        {
          hash: "abc1234def5678",
          date: "2026-02-27T10:00:00Z",
          message: "Automated backup: 2026-02-27",
        },
        {
          hash: "def5678abc1234",
          date: "2026-02-26T10:00:00Z",
          message: "Automated backup: 2026-02-26",
        },
      ],
    });

    const result = await gitLog();

    expect(result).toEqual([
      {
        hash: "abc1234def5678",
        date: "2026-02-27T10:00:00Z",
        message: "Automated backup: 2026-02-27",
      },
      {
        hash: "def5678abc1234",
        date: "2026-02-26T10:00:00Z",
        message: "Automated backup: 2026-02-26",
      },
    ]);
    expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 20 });
  });

  it("returns empty array when no commits exist", async () => {
    mockGit.log.mockResolvedValue({ all: [] });

    const result = await gitLog();

    expect(result).toEqual([]);
  });

  it("respects custom limit", async () => {
    mockGit.log.mockResolvedValue({ all: [] });

    await gitLog(5);

    expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 5 });
  });
});

describe("buildCommitMessage", () => {
  function changes(
    overrides: Partial<{
      created: string[];
      deleted: string[];
      modified: string[];
      renamed: Array<{ from: string; to: string }>;
    }> = {},
  ) {
    return {
      created: [],
      deleted: [],
      modified: [],
      renamed: [],
      ...overrides,
    };
  }

  it("returns fallback when no changes", () => {
    expect(buildCommitMessage(changes())).toBe("backup: no changes");
  });

  it("shows single modified file", () => {
    expect(buildCommitMessage(changes({ modified: ["machine/.zshrc"] }))).toBe("modified: .zshrc");
  });

  it("shows multiple modified files", () => {
    expect(
      buildCommitMessage(changes({ modified: ["m/.zshrc", "m/.gitconfig", "m/.vimrc"] })),
    ).toBe("modified: .zshrc, .gitconfig, .vimrc");
  });

  it("shows added files only when no other changes", () => {
    expect(buildCommitMessage(changes({ created: ["m/.npmrc", "m/.prettierrc"] }))).toBe(
      "added: .npmrc, .prettierrc",
    );
  });

  it("shows removed files only when no other changes", () => {
    expect(buildCommitMessage(changes({ deleted: ["m/kibana.dev.yml"] }))).toBe(
      "removed: kibana.dev.yml",
    );
  });

  it("orders categories: removed, added, modified", () => {
    expect(
      buildCommitMessage(
        changes({
          created: ["m/settings.json"],
          deleted: ["m/kibana.dev.yml"],
          modified: ["m/.zshrc"],
        }),
      ),
    ).toBe("removed: kibana.dev.yml; added: settings.json; modified: .zshrc");
  });

  it("skips empty categories", () => {
    expect(buildCommitMessage(changes({ created: ["m/a.txt"], modified: ["m/b.txt"] }))).toBe(
      "added: a.txt; modified: b.txt",
    );
  });

  it("includes renamed files in modified", () => {
    expect(
      buildCommitMessage(changes({ renamed: [{ from: "m/old.conf", to: "m/new.conf" }] })),
    ).toBe("modified: new.conf");
  });

  it("strips directory paths and shows only basenames", () => {
    expect(buildCommitMessage(changes({ modified: ["machine/deeply/nested/dir/.zshrc"] }))).toBe(
      "modified: .zshrc",
    );
  });

  it("deduplicates identical basenames within a category", () => {
    expect(
      buildCommitMessage(changes({ modified: ["m/dir1/config.json", "m/dir2/config.json"] })),
    ).toBe("modified: config.json");
  });

  it("collapses modified to count first when message exceeds maxLen", () => {
    const longNames = Array.from({ length: 20 }, (_, i) => `m/very-long-filename-${i}.config.ts`);
    const msg = buildCommitMessage(
      changes({ deleted: ["m/important.yml"], modified: longNames }),
      100,
    );
    expect(msg).toBe("removed: important.yml; modified: 20 files");
  });

  it("collapses added next when still too long", () => {
    const manyAdded = Array.from({ length: 15 }, (_, i) => `m/added-file-${i}.ts`);
    const manyModified = Array.from({ length: 15 }, (_, i) => `m/modified-file-${i}.ts`);
    const msg = buildCommitMessage(changes({ created: manyAdded, modified: manyModified }), 60);
    expect(msg).toBe("added: 15 files; modified: 15 files");
  });

  it("collapses all categories to counts when needed", () => {
    const msg = buildCommitMessage(
      changes({
        deleted: Array.from({ length: 10 }, (_, i) => `m/del-${i}.ts`),
        created: Array.from({ length: 10 }, (_, i) => `m/add-${i}.ts`),
        modified: Array.from({ length: 10 }, (_, i) => `m/mod-${i}.ts`),
      }),
      60,
    );
    expect(msg).toBe("removed: 10 files; added: 10 files; modified: 10 files");
  });

  it("hard-truncates with ellipsis as last resort", () => {
    const msg = buildCommitMessage(
      changes({
        deleted: Array.from({ length: 50 }, (_, i) => `m/deleted-${i}.ts`),
        created: Array.from({ length: 50 }, (_, i) => `m/created-${i}.ts`),
        modified: Array.from({ length: 50 }, (_, i) => `m/modified-${i}.ts`),
      }),
      30,
    );
    expect(msg.length).toBeLessThanOrEqual(30);
    expect(msg).toMatch(/\.\.\.$/);
  });

  it("uses singular 'file' for count of 1", () => {
    const msg = buildCommitMessage(
      changes({
        deleted: ["m/gone.txt"],
        modified: Array.from({ length: 20 }, (_, i) => `m/long-filename-number-${i}.txt`),
      }),
      50,
    );
    expect(msg).toContain("modified: 20 files");
  });
});

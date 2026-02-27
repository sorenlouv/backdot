import { describe, it, expect, vi, beforeEach } from "vitest";
import { CleanOptions } from "simple-git";

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
  remote: vi.fn().mockResolvedValue("git@github.com:user/repo.git"),
  log: vi.fn().mockResolvedValue({ all: [] }),
};

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
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

vi.mock("./staging.js", () => ({
  STAGING_DIR: "/mock/staging",
}));

import fs from "node:fs";
import { gitPull, gitCommitAndPush, gitLog, buildCommitMessage } from "./git.js";

describe("gitPull", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");
    mockGit.reset.mockResolvedValue(undefined);
    mockGit.clean.mockResolvedValue(undefined);
    mockGit.clone.mockResolvedValue(undefined);
    mockGit.init.mockResolvedValue(undefined);
    mockGit.addRemote.mockResolvedValue(undefined);
  });

  it("fetches and hard resets when .git exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await gitPull("git@github.com:test/repo.git");

    expect(mockGit.fetch).toHaveBeenCalledWith("origin");
    expect(mockGit.reset).toHaveBeenCalledWith(["--hard", "origin/main"]);
    expect(mockGit.clean).toHaveBeenCalledWith(CleanOptions.FORCE, ["-d"]);
  });

  it("clones when .git does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await gitPull("git@github.com:test/repo.git");

    expect(mockGit.clone).toHaveBeenCalledWith("git@github.com:test/repo.git", "/mock/staging");
  });

  it("falls back to init when clone fails (empty remote)", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockGit.clone.mockRejectedValue(new Error("empty repository"));

    await gitPull("git@github.com:test/repo.git");

    expect(fs.mkdirSync).toHaveBeenCalledWith("/mock/staging", { recursive: true });
    expect(mockGit.init).toHaveBeenCalled();
    expect(mockGit.addRemote).toHaveBeenCalledWith("origin", "git@github.com:test/repo.git");
  });

  it("re-throws non-empty-repo clone errors", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockGit.clone.mockRejectedValue(new Error("Could not resolve host: github.com"));

    await expect(gitPull("git@github.com:test/repo.git")).rejects.toThrow("Could not resolve host");

    expect(mockGit.init).not.toHaveBeenCalled();
  });

  it("resets to a specific commit when commit parameter is provided", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await gitPull("git@github.com:test/repo.git", "abc1234");

    expect(mockGit.fetch).toHaveBeenCalledWith("origin");
    expect(mockGit.revparse).not.toHaveBeenCalled();
    expect(mockGit.reset).toHaveBeenCalledWith(["--hard", "abc1234"]);
    expect(mockGit.clean).toHaveBeenCalledWith(CleanOptions.FORCE, ["-d"]);
  });

  it("resets to commit after cloning when commit parameter is provided", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await gitPull("git@github.com:test/repo.git", "abc1234");

    expect(mockGit.clone).toHaveBeenCalledWith("git@github.com:test/repo.git", "/mock/staging");
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
    mockGit.remote.mockResolvedValue("git@github.com:user/repo.git");
  });

  const dirtyStatus = {
    isClean: () => false,
    created: [],
    deleted: [],
    modified: ["machine/.zshrc"],
    renamed: [],
  };

  it("returns null when status is clean", async () => {
    mockGit.status.mockResolvedValue({
      isClean: () => true,
      created: [],
      deleted: [],
      modified: [],
      renamed: [],
    });

    const result = await gitCommitAndPush();

    expect(result).toBeNull();
    expect(mockGit.add).toHaveBeenCalledWith(".");
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it("commits, pushes, and returns commit URL for known hosts", async () => {
    mockGit.status.mockResolvedValue(dirtyStatus);

    const result = await gitCommitAndPush();

    expect(mockGit.commit).toHaveBeenCalledWith("modified: .zshrc");
    expect(mockGit.push).toHaveBeenCalledWith(["-u", "origin", "HEAD"]);
    expect(result).toEqual({
      commitUrl: "https://github.com/user/repo/commit/abc1234",
    });
  });

  it("returns null commitUrl for unknown hosts", async () => {
    mockGit.status.mockResolvedValue(dirtyStatus);
    mockGit.remote.mockResolvedValue("git@selfhosted.example.com:user/repo.git");

    const result = await gitCommitAndPush();

    expect(result).toEqual({ commitUrl: null });
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
    expect(buildCommitMessage(changes())).toBe("backup");
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

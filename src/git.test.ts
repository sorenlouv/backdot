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
import { gitPull, gitCommitAndPush } from "./git.js";

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

  it("returns null when status is clean", async () => {
    mockGit.status.mockResolvedValue({ isClean: () => true });

    const result = await gitCommitAndPush();

    expect(result).toBeNull();
    expect(mockGit.add).toHaveBeenCalledWith(".");
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it("commits, pushes, and returns commit URL for known hosts", async () => {
    mockGit.status.mockResolvedValue({ isClean: () => false });

    const result = await gitCommitAndPush();

    expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining("Automated backup:"));
    expect(mockGit.push).toHaveBeenCalledWith(["-u", "origin", "HEAD"]);
    expect(result).toEqual({
      commitUrl: "https://github.com/user/repo/commit/abc1234",
    });
  });

  it("returns null commitUrl for unknown hosts", async () => {
    mockGit.status.mockResolvedValue({ isClean: () => false });
    mockGit.remote.mockResolvedValue("git@selfhosted.example.com:user/repo.git");

    const result = await gitCommitAndPush();

    expect(result).toEqual({ commitUrl: null });
  });
});

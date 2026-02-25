import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGit = {
  init: vi.fn().mockResolvedValue(undefined),
  addRemote: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue(undefined),
  status: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
};

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("./log.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("./staging.js", () => ({
  STAGING_DIR: "/mock/staging",
}));

import fs from "node:fs";
import { gitSync } from "./git.js";

describe("gitSync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.init.mockResolvedValue(undefined);
    mockGit.addRemote.mockResolvedValue(undefined);
    mockGit.add.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue(undefined);
    mockGit.push.mockResolvedValue(undefined);
  });

  it("initializes a new repo when .git does not exist", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return !String(p).endsWith(".git");
    });
    mockGit.status.mockResolvedValue({ isClean: () => true });

    await gitSync("git@github.com:test/repo.git");

    expect(mockGit.init).toHaveBeenCalled();
    expect(mockGit.addRemote).toHaveBeenCalledWith("origin", "git@github.com:test/repo.git");
  });

  it("skips init when .git already exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true });

    await gitSync("git@github.com:test/repo.git");

    expect(mockGit.init).not.toHaveBeenCalled();
    expect(mockGit.addRemote).not.toHaveBeenCalled();
  });

  it("skips commit and push when status is clean", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true });

    await gitSync("git@github.com:test/repo.git");

    expect(mockGit.add).toHaveBeenCalledWith(".");
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it("commits and pushes when there are changes", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => false });

    await gitSync("git@github.com:test/repo.git");

    expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining("Automated backup:"));
    expect(mockGit.push).toHaveBeenCalledWith(["-u", "origin", "HEAD"]);
  });

  it("creates staging dir if it does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockGit.status.mockResolvedValue({ isClean: () => true });

    await gitSync("git@github.com:test/repo.git");

    expect(fs.mkdirSync).toHaveBeenCalledWith("/mock/staging", { recursive: true });
  });
});

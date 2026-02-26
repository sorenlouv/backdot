import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockGit = {
  fetch: vi.fn(),
  revparse: vi.fn(),
};
vi.mock("simple-git", () => ({
  simpleGit: () => mockGit,
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  cleanStaging,
  copyToStaging,
  writeRepoReadme,
  getStagedPath,
  compareFiles,
  STAGING_DIR,
  machineDir,
} from "./staging.js";

const HOME = os.homedir();
const MACHINE = "sorens-work-laptop";

describe("machineDir", () => {
  it("returns STAGING_DIR joined with the machine name", () => {
    expect(machineDir(MACHINE)).toBe(path.join(STAGING_DIR, MACHINE));
  });
});

describe("copyToStaging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("copies files into the machine subfolder preserving directory structure relative to home", () => {
    const files = [`${HOME}/.zshrc`, `${HOME}/.config/ghostty/config`];
    copyToStaging(files, MACHINE);

    const dir = machineDir(MACHINE);
    expect(fs.copyFileSync).toHaveBeenCalledWith(`${HOME}/.zshrc`, path.join(dir, ".zshrc"));
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      `${HOME}/.config/ghostty/config`,
      path.join(dir, ".config/ghostty/config"),
    );
  });

  it("handles files outside home dir by stripping leading slash", () => {
    const files = ["/etc/hosts"];
    copyToStaging(files, MACHINE);

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      "/etc/hosts",
      path.join(machineDir(MACHINE), "etc/hosts"),
    );
  });

  it("creates machine dir if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    copyToStaging([`${HOME}/.zshrc`], MACHINE);

    expect(fs.mkdirSync).toHaveBeenCalledWith(machineDir(MACHINE), { recursive: true });
  });

  it("continues on copy failure and logs warning", () => {
    vi.mocked(fs.copyFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    copyToStaging([`${HOME}/.zshrc`, `${HOME}/.bashrc`], MACHINE);
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
  });
});

describe("writeRepoReadme", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes README.md to the staging directory root", () => {
    const repo = "https://github.com/sorenlouv/dotfiles-backup.git";
    writeRepoReadme(repo);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(STAGING_DIR, "README.md"),
      expect.stringContaining(`backdot --restore ${repo}`),
    );
  });
});

describe("cleanStaging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when machine dir does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    cleanStaging(MACHINE);
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it("removes the machine directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    cleanStaging(MACHINE);

    expect(fs.rmSync).toHaveBeenCalledTimes(1);
    expect(fs.rmSync).toHaveBeenCalledWith(machineDir(MACHINE), {
      recursive: true,
      force: true,
    });
  });
});

describe("getStagedPath", () => {
  it("maps a home-relative file to the machine subdirectory", () => {
    expect(getStagedPath(`${HOME}/.zshrc`, MACHINE)).toBe(path.join(machineDir(MACHINE), ".zshrc"));
  });

  it("preserves nested directory structure", () => {
    expect(getStagedPath(`${HOME}/.config/ghostty/config`, MACHINE)).toBe(
      path.join(machineDir(MACHINE), ".config/ghostty/config"),
    );
  });

  it("handles files outside home dir by stripping leading slash", () => {
    expect(getStagedPath("/etc/hosts", MACHINE)).toBe(path.join(machineDir(MACHINE), "etc/hosts"));
  });
});

describe("compareFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns error when no git repo exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const files = [`${HOME}/.zshrc`, `${HOME}/.npmrc`];

    const result = await compareFiles(files, MACHINE);

    expect(result.error).toContain("Could not fetch status");
    expect(result.notBackedUp).toEqual([]);
  });

  it("returns empty result for empty file list", async () => {
    const result = await compareFiles([], MACHINE);

    expect(result.notBackedUp).toEqual([]);
    expect(result.backedUp).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it("categorises files by comparing git hashes", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");

    const zshrcPath = `${MACHINE}/.zshrc`;
    const npmrcPath = `${MACHINE}/.npmrc`;

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "ls-tree") {
        return `100644 blob aaa111\t${zshrcPath}\n100644 blob bbb222\t${npmrcPath}\n`;
      }
      // hash-object: return matching hash for .zshrc, different for .npmrc
      return "aaa111\nccc333\n";
    });

    const files = [`${HOME}/.zshrc`, `${HOME}/.npmrc`];
    const result = await compareFiles(files, MACHINE);

    expect(result.backedUp).toEqual([`${HOME}/.zshrc`]);
    expect(result.modified).toEqual([`${HOME}/.npmrc`]);
    expect(result.notBackedUp).toEqual([]);
  });

  it("marks files as notBackedUp when not in ls-tree output", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "ls-tree") return "";
      return "aaa111\n";
    });

    const files = [`${HOME}/.zshrc`];
    const result = await compareFiles(files, MACHINE);

    expect(result.notBackedUp).toEqual([`${HOME}/.zshrc`]);
    expect(result.backedUp).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it("returns error when ls-tree fails", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");

    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("fatal: not a tree object");
    });

    const files = [`${HOME}/.zshrc`];
    const result = await compareFiles(files, MACHINE);

    expect(result.error).toContain("Could not fetch status");
    expect(result.error).toContain("not a tree object");
  });

  it("returns error when revparse fails", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockRejectedValue(new Error("HEAD not found"));

    const files = [`${HOME}/.zshrc`];
    const result = await compareFiles(files, MACHINE);

    expect(result.error).toContain("Could not fetch status");
    expect(result.error).toContain("HEAD not found");
  });

  it("returns error when fetch fails", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockRejectedValue(new Error("Could not resolve host"));

    const files = [`${HOME}/.zshrc`];
    const result = await compareFiles(files, MACHINE);

    expect(result.error).toContain("Could not fetch status");
    expect(result.error).toContain("Could not resolve host");
  });
});

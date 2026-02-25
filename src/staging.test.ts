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

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import fs from "node:fs";
import { cleanStaging, copyToStaging, writeRepoReadme, STAGING_DIR, machineDir } from "./staging.js";

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
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      `${HOME}/.zshrc`,
      path.join(dir, ".zshrc"),
    );
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
    writeRepoReadme();

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(STAGING_DIR, "README.md"),
      expect.stringContaining("https://github.com/sorenlouv/backdot"),
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

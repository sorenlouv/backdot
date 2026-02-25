import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
  },
}));

vi.mock("./log.js", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
}));

import fs from "node:fs";
import { copyToStaging, STAGING_DIR } from "./staging.js";

const HOME = os.homedir();

describe("copyToStaging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("copies files preserving directory structure relative to home", () => {
    const files = [`${HOME}/.zshrc`, `${HOME}/.config/ghostty/config`];
    copyToStaging(files);

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      `${HOME}/.zshrc`,
      path.join(STAGING_DIR, ".zshrc"),
    );
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      `${HOME}/.config/ghostty/config`,
      path.join(STAGING_DIR, ".config/ghostty/config"),
    );
  });

  it("handles files outside home dir by stripping leading slash", () => {
    const files = ["/etc/hosts"];
    copyToStaging(files);

    expect(fs.copyFileSync).toHaveBeenCalledWith("/etc/hosts", path.join(STAGING_DIR, "etc/hosts"));
  });

  it("creates staging dir if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    copyToStaging([`${HOME}/.zshrc`]);

    expect(fs.mkdirSync).toHaveBeenCalledWith(STAGING_DIR, { recursive: true });
  });

  it("continues on copy failure and logs warning", () => {
    vi.mocked(fs.copyFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    copyToStaging([`${HOME}/.zshrc`, `${HOME}/.bashrc`]);
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
  });
});

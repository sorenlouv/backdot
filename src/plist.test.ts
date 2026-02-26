import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { isScheduled } from "./plist.js";

describe("isScheduled", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns false when plist file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(isScheduled()).toBe(false);
  });

  it("returns true when launchctl lists the job", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execFileSync).mockReturnValue('"com.backdot.daemon" = { ... }');
    expect(isScheduled()).toBe(true);
  });

  it("returns false when launchctl throws (job not loaded)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("Could not find service");
    });
    expect(isScheduled()).toBe(false);
  });
});

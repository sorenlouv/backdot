import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { execFileSync } from "node:child_process";
import os from "node:os";
import { runPostRestoreHook } from "./postRestoreHook.js";
import { POST_RESTORE_HOOK_PATH } from "./paths.js";

describe("runPostRestoreHook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs the hook via /bin/sh from HOME with inherited stdio", () => {
    runPostRestoreHook();

    expect(execFileSync).toHaveBeenCalledWith(
      "/bin/sh",
      [POST_RESTORE_HOOK_PATH],
      expect.objectContaining({ cwd: os.homedir(), stdio: "inherit" }),
    );
  });

  it("throws a partial-success error including the exit code when the hook fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      const error = new Error("Command failed") as Error & { status: number };
      error.status = 3;
      throw error;
    });

    expect(() => runPostRestoreHook()).toThrow(
      /Files were restored.*post-restore hook failed.*exit code 3/s,
    );
  });
});

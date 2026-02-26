import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { execSync } from "node:child_process";
import { logger } from "./log.js";
import { sendNotification } from "./notify.js";

describe("sendNotification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  it("calls osascript with title and message on macOS", () => {
    sendNotification("Backdot", "Backup failed: auth expired");

    expect(execSync).toHaveBeenCalledOnce();
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain("display notification");
    expect(cmd).toContain("Backup failed: auth expired");
    expect(cmd).toContain('with title "Backdot"');
    expect(cmd).toContain('subtitle "Scheduled backup failed"');
  });

  it("escapes double quotes and backslashes in the message", () => {
    sendNotification("Backdot", 'path "C:\\foo" failed');

    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('path \\"C:\\\\foo\\" failed');
  });

  it("does nothing on non-darwin platforms", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });

    sendNotification("Backdot", "Backup failed");

    expect(execSync).not.toHaveBeenCalled();
  });

  it("swallows osascript errors and logs a warning", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("osascript not found");
    });

    expect(() => sendNotification("Backdot", "Backup failed")).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith("Failed to send notification: osascript not found");
  });
});

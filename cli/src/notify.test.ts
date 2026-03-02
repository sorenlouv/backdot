import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { execFileSync } from "node:child_process";
import { logger } from "./log.js";
import { sendNotification } from "./notify.js";

describe("sendNotification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  it("calls osascript with title and message on macOS", () => {
    sendNotification("Backdot", "Backup failed: auth expired");

    expect(execFileSync).toHaveBeenCalledOnce();
    const [bin, args] = vi.mocked(execFileSync).mock.calls[0] as [string, string[]];
    expect(bin).toBe("osascript");
    const script = args[1];
    expect(script).toContain("display notification");
    expect(script).toContain("Backup failed: auth expired");
    expect(script).toContain('with title "Backdot"');
    expect(script).toContain('subtitle "Scheduled backup failed"');
  });

  it("escapes double quotes and backslashes in the message", () => {
    sendNotification("Backdot", 'path "C:\\foo" failed');

    const [, args] = vi.mocked(execFileSync).mock.calls[0] as [string, string[]];
    const script = args[1];
    expect(script).toContain('path \\"C:\\\\foo\\" failed');
  });

  it("does nothing on non-darwin platforms", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });

    sendNotification("Backdot", "Backup failed");

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("swallows osascript errors and logs a warning", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("osascript not found");
    });

    expect(() => sendNotification("Backdot", "Backup failed")).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith("Failed to send notification: osascript not found");
  });
});

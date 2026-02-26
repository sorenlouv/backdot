import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import fs from "node:fs";
import { init } from "./init.js";

describe("init", () => {
  let logged: string;

  beforeEach(() => {
    vi.resetAllMocks();
    logged = "";
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged += args.join(" ") + "\n";
    });
  });

  it("creates config file when it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    init();

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
    expect(filePath).toContain(".backdot.json");

    const parsed = JSON.parse(content);
    expect(parsed.repository).toBe("git@github.com:USERNAME/backdot-backup.git");
    expect(parsed.machine).toBe(os.hostname());
    expect(parsed["files.gitignored"]).toEqual([]);
    expect(parsed["files.match"]).toEqual(["~/.zshrc", "~/.gitconfig"]);
  });

  it("does not overwrite existing config file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    init();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(logged).toContain("already exists");
  });

  it("prints repo creation deep links", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    init();

    expect(logged).toContain("github.com/new");
    expect(logged).toContain("gitlab.com/projects/new");
    expect(logged).toContain("bitbucket.org/repo/create");
  });

  it("prints next-step commands", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    init();

    expect(logged).toContain("--backup");
    expect(logged).toContain("--schedule");
    expect(logged).toContain("--status");
  });
});

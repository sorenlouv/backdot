import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
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
    expect(filePath).toContain("config.json");

    const parsed = JSON.parse(content);
    expect(parsed.repository).toBe("git@github.com:USERNAME/backdot-backup.git");
    expect(parsed.machine).toBeTruthy();
    expect(parsed.machine).not.toMatch(/\.(local|localdomain)$/);
    expect(parsed.paths).toEqual(["~/.zshrc", "~/.gitconfig"]);
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

    expect(logged).toContain("backdot backup");
    expect(logged).toContain("backdot schedule");
    expect(logged).toContain("backdot status");
  });
});

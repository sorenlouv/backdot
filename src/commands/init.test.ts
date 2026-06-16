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
    expect(parsed.repository).toBe("https://github.com/USERNAME/backdot-backup.git");
    expect(parsed.token).toBeUndefined();
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

  it("prints the GitHub repo creation deep link", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    init();

    expect(logged).toContain("github.com/new");
    expect(logged).not.toContain("gitlab.com/projects/new");
    expect(logged).not.toContain("bitbucket.org/repo/create");
  });

  it("prints GitHub token guidance", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    init();

    expect(logged).toContain("personal-access-tokens");
    expect(logged).toContain("github.token");
    expect(logged).toContain("BACKDOT_GITHUB_TOKEN");
  });

  it("prints next-step commands", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    init();

    expect(logged).toContain("backdot backup");
    expect(logged).toContain("backdot schedule");
    expect(logged).toContain("backdot status");
  });
});

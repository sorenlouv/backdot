import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    accessSync: vi.fn(),
    statSync: vi.fn(),
    constants: { R_OK: 4 },
  },
}));

vi.mock("fast-glob", () => ({
  default: { sync: vi.fn() },
}));

vi.mock("./log.js", () => ({
  logWarn: vi.fn(),
}));

import fs from "node:fs";
import { execSync } from "node:child_process";
import fg from "fast-glob";
import { resolveFiles } from "./resolve.js";

const fileStatMock = { isFile: () => true } as ReturnType<typeof fs.statSync>;
const dirStatMock = { isFile: () => false } as ReturnType<typeof fs.statSync>;

function makeFiles(
  gitignored: string[] = [],
  match: string[] = [],
): { gitignored: string[]; match: string[] } {
  return { gitignored, match };
}

describe("resolveFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves gitignored files from a directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue("secret.env\n.env.local\n");
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    const files = resolveFiles(makeFiles(["/home/user/project"]));
    expect(files).toHaveLength(2);
    expect(files[0]).toContain("secret.env");
    expect(files[1]).toContain(".env.local");
  });

  it("resolves glob patterns", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.zshrc", "/home/user/.bashrc"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    const files = resolveFiles(makeFiles([], ["~/.z*"]));
    expect(files).toEqual(["/home/user/.zshrc", "/home/user/.bashrc"]);
  });

  it("returns empty array for non-existent gitignored directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const files = resolveFiles(makeFiles(["/nonexistent"]));
    expect(files).toEqual([]);
  });

  it("filters out non-regular files", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/somedir"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(dirStatMock);

    const files = resolveFiles(makeFiles([], ["/home/user/*"]));
    expect(files).toEqual([]);
  });

  it("filters out unreadable files", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.secret"]);
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const files = resolveFiles(makeFiles([], ["/home/user/.*"]));
    expect(files).toEqual([]);
  });

  it("handles both gitignored and match entries", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue(".env\n");
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.zshrc"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    const files = resolveFiles(makeFiles(["/home/user/project"], ["~/.zshrc"]));
    expect(files).toHaveLength(2);
  });

  it("returns empty array when git command fails", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("git error");
    });

    const files = resolveFiles(makeFiles(["/home/user/project"]));
    expect(files).toEqual([]);
  });
});

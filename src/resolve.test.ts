import { describe, it, expect, vi, beforeEach } from "vitest";

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import fs from "node:fs";
import fg from "fast-glob";
import { resolveFiles } from "./resolve.js";

const fileStatMock = { isFile: () => true, size: 1024 } as ReturnType<typeof fs.statSync>;
const dirStatMock = { isFile: () => false, size: 0 } as ReturnType<typeof fs.statSync>;
const largeFileStatMock = {
  isFile: () => true,
  size: 20 * 1024 * 1024,
} as ReturnType<typeof fs.statSync>;

describe("resolveFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves glob patterns", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.zshrc", "/home/user/.bashrc"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    const files = resolveFiles({ paths: ["~/.z*"] });
    expect(files).toEqual(["/home/user/.zshrc", "/home/user/.bashrc"]);
  });

  it("filters out non-regular files", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/somedir"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(dirStatMock);

    const files = resolveFiles({ paths: ["/home/user/*"] });
    expect(files).toEqual([]);
  });

  it("filters out unreadable files", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.secret"]);
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const files = resolveFiles({ paths: ["/home/user/.*"] });
    expect(files).toEqual([]);
  });

  it("filters out files larger than 10 MB", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/big-file.bin"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(largeFileStatMock);

    const files = resolveFiles({ paths: ["/home/user/big-file.bin"] });
    expect(files).toEqual([]);
  });

  it("keeps files under 10 MB", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.zshrc"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    const files = resolveFiles({ paths: ["/home/user/.zshrc"] });
    expect(files).toEqual(["/home/user/.zshrc"]);
  });

  it("passes all patterns to fast-glob in a single call", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.zshrc"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    resolveFiles({ paths: ["/home/user/**", "!/home/user/tmp/**"] });
    expect(fg.sync).toHaveBeenCalledTimes(1);
    expect(fg.sync).toHaveBeenCalledWith(["/home/user/**", "!/home/user/tmp/**"], {
      absolute: true,
      dot: true,
    });
  });

  it("passes negation patterns through to fast-glob", () => {
    vi.mocked(fg.sync).mockReturnValue(["/home/user/.zshrc"]);
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue(fileStatMock);

    const files = resolveFiles({
      paths: ["/home/user/**", "!/home/user/.cache/**"],
    });
    expect(files).toEqual(["/home/user/.zshrc"]);
  });

  it("returns empty array when paths is empty", () => {
    const files = resolveFiles({ paths: [] });
    expect(files).toEqual([]);
    expect(fg.sync).not.toHaveBeenCalled();
  });
});

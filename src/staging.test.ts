import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockGit = {
  fetch: vi.fn(),
  revparse: vi.fn(),
};
vi.mock("simple-git", () => ({
  simpleGit: () => mockGit,
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./git.js", async () => {
  const actual = await vi.importActual<typeof import("./git.js")>("./git.js");
  return {
    ensureRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getCurrentBranch: vi.fn(async (git: { revparse: (args: string[]) => Promise<string> }) =>
      (await git.revparse(["--abbrev-ref", "HEAD"])).trim(),
    ),
    gitError: actual.gitError,
  };
});

const mockEncrypt = vi.fn((buf: Buffer) => Buffer.concat([Buffer.from("ENCRYPTED:"), buf]));
const mockDerivedKey = { password: "test-password", salt: Buffer.alloc(32), key: Buffer.alloc(32) };
vi.mock("./crypto/encryption.js", () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...(args as [Buffer])),
  decrypt: (buf: Buffer) => buf.subarray(10),
  deriveKey: () => mockDerivedKey,
}));

vi.mock("./crypto/password.js", () => ({
  KEY_FILE_PATH: "/mock-home/.backdot/encryption.key",
  ENC_SUFFIX: ".encrypted",
}));

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  cleanStaging,
  copyToStaging,
  writeRepoReadme,
  getStagedPath,
  getRestoreTarget,
  compareFiles,
  STAGING_DIR,
  machineDir,
} from "./staging.js";
import { TOKEN_FILE_PATH } from "./paths.js";

const HOME = os.homedir();
const MACHINE = "sorens-work-laptop";
const REPO = "https://github.com/sorenlouv/dotfiles-backup.git";

describe("machineDir", () => {
  it("returns STAGING_DIR joined with the machine name", () => {
    expect(machineDir(MACHINE)).toBe(path.join(STAGING_DIR, MACHINE));
  });
});

describe("copyToStaging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("copies HOME files into the machine's home/ namespace preserving directory structure", () => {
    const files = [`${HOME}/.zshrc`, `${HOME}/.config/ghostty/config`];
    copyToStaging(files, MACHINE);

    const dir = machineDir(MACHINE);
    expect(fs.copyFileSync).toHaveBeenCalledWith(`${HOME}/.zshrc`, path.join(dir, "home/.zshrc"));
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      `${HOME}/.config/ghostty/config`,
      path.join(dir, "home/.config/ghostty/config"),
    );
  });

  it("copies files outside HOME into the machine's root/ namespace", () => {
    const files = ["/etc/hosts"];
    copyToStaging(files, MACHINE);

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      "/etc/hosts",
      path.join(machineDir(MACHINE), "root/etc/hosts"),
    );
  });

  it("creates machine dir if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    copyToStaging([`${HOME}/.zshrc`], MACHINE);

    expect(fs.mkdirSync).toHaveBeenCalledWith(machineDir(MACHINE), { recursive: true });
  });

  it("continues on copy failure and logs warning", () => {
    vi.mocked(fs.copyFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    copyToStaging([`${HOME}/.zshrc`, `${HOME}/.bashrc`], MACHINE);
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
  });
});

describe("writeRepoReadme", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes README.md to the staging directory root", () => {
    const repo = "https://github.com/sorenlouv/dotfiles-backup.git";
    writeRepoReadme(repo);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(STAGING_DIR, "README.md"),
      expect.stringContaining(`backdot restore ${repo}`),
    );
  });
});

describe("cleanStaging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("removes only the home/ and root/ namespaces, preserving other files in the machine dir", () => {
    cleanStaging(MACHINE);

    expect(fs.rmSync).toHaveBeenCalledTimes(2);
    expect(fs.rmSync).toHaveBeenCalledWith(path.join(machineDir(MACHINE), "home"), {
      recursive: true,
      force: true,
    });
    expect(fs.rmSync).toHaveBeenCalledWith(path.join(machineDir(MACHINE), "root"), {
      recursive: true,
      force: true,
    });
  });
});

describe("getStagedPath", () => {
  it("maps a HOME file into the home/ namespace", () => {
    expect(getStagedPath(`${HOME}/.zshrc`, MACHINE)).toBe(
      path.join(machineDir(MACHINE), "home/.zshrc"),
    );
  });

  it("preserves nested directory structure", () => {
    expect(getStagedPath(`${HOME}/.config/ghostty/config`, MACHINE)).toBe(
      path.join(machineDir(MACHINE), "home/.config/ghostty/config"),
    );
  });

  it("maps a file outside HOME into the root/ namespace", () => {
    expect(getStagedPath("/etc/hosts", MACHINE)).toBe(
      path.join(machineDir(MACHINE), "root/etc/hosts"),
    );
  });
});

describe("getRestoreTarget", () => {
  it("maps a home/ path back to the restoring machine's HOME", () => {
    expect(getRestoreTarget(path.join("home", ".zshrc"))).toEqual({
      destination: path.join(HOME, ".zshrc"),
      displayPath: "~/.zshrc",
    });
  });

  it("maps a root/ path back to its absolute path", () => {
    expect(getRestoreTarget(path.join("root", "etc/hosts"))).toEqual({
      destination: "/etc/hosts",
      displayPath: "/etc/hosts",
    });
  });

  it("is the inverse of getStagedPath for HOME and non-HOME files", () => {
    for (const original of [`${HOME}/.config/nvim/init.lua`, "/etc/ssh/sshd_config"]) {
      const machineRelativePath = path.relative(
        machineDir(MACHINE),
        getStagedPath(original, MACHINE),
      );
      expect(getRestoreTarget(machineRelativePath).destination).toBe(original);
    }
  });
});

describe("compareFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("treats a missing local repo as an empty remote (pre-backup preview)", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const files = [`${HOME}/.zshrc`, `${HOME}/.npmrc`];

    const result = await compareFiles({
      files,
      machine: MACHINE,
      repository: REPO,
      token: "test-token",
    });

    expect(result.remoteIsEmpty).toBe(true);
    expect(result.notBackedUp).toEqual(files);
    expect(result.backedUp).toEqual([]);
  });

  it("returns empty result for empty file list", async () => {
    const result = await compareFiles({
      files: [],
      machine: MACHINE,
      repository: REPO,
      token: "test-token",
    });

    expect(result.notBackedUp).toEqual([]);
    expect(result.backedUp).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it("categorises files by comparing git hashes", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");

    const zshrcPath = `${MACHINE}/home/.zshrc`;
    const npmrcPath = `${MACHINE}/home/.npmrc`;

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "ls-tree") {
        return `100644 blob aaa111\t${zshrcPath}\n100644 blob bbb222\t${npmrcPath}\n`;
      }
      return "aaa111\nccc333\n";
    });

    const files = [`${HOME}/.zshrc`, `${HOME}/.npmrc`];
    const result = await compareFiles({
      files,
      machine: MACHINE,
      repository: REPO,
      token: "test-token",
    });

    expect(result.backedUp).toEqual([`${HOME}/.zshrc`]);
    expect(result.modified).toEqual([`${HOME}/.npmrc`]);
    expect(result.notBackedUp).toEqual([]);
  });

  it("treats an empty ls-tree (no snapshot for this machine) as an empty remote", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "ls-tree") {
        return "";
      }
      return "aaa111\n";
    });

    const files = [`${HOME}/.zshrc`];
    const result = await compareFiles({
      files,
      machine: MACHINE,
      repository: REPO,
      token: "test-token",
    });

    expect(result.remoteIsEmpty).toBe(true);
    expect(result.notBackedUp).toEqual([`${HOME}/.zshrc`]);
    expect(result.backedUp).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it("throws when ls-tree fails", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockResolvedValue("main");

    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("fatal: not a tree object");
    });

    const files = [`${HOME}/.zshrc`];
    await expect(
      compareFiles({ files, machine: MACHINE, repository: REPO, token: "test-token" }),
    ).rejects.toThrow("fatal: not a tree object");
  });

  it("throws when revparse fails", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockResolvedValue(undefined);
    mockGit.revparse.mockRejectedValue(new Error("HEAD not found"));

    const files = [`${HOME}/.zshrc`];
    await expect(
      compareFiles({ files, machine: MACHINE, repository: REPO, token: "test-token" }),
    ).rejects.toThrow("HEAD not found");
  });

  it("throws a friendly error when fetch fails", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockRejectedValue(new Error("Could not resolve host"));

    const files = [`${HOME}/.zshrc`];
    await expect(
      compareFiles({ files, machine: MACHINE, repository: REPO, token: "test-token" }),
    ).rejects.toThrow("Could not connect to remote host. Check your internet connection.");
  });

  it("throws a friendly error for a not-found repository", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.fetch.mockRejectedValue(new Error("remote: Repository not found."));

    const files = [`${HOME}/.zshrc`];
    await expect(
      compareFiles({ files, machine: MACHINE, repository: REPO, token: "test-token" }),
    ).rejects.toThrow(`Repository "${REPO}" not found, or your GitHub token can't access it.`);
  });
});

describe("copyToStaging with encryption", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("file content"));
    mockEncrypt.mockImplementation((buf: Buffer) =>
      Buffer.concat([Buffer.from("ENCRYPTED:"), buf]),
    );
  });

  it("encrypts files and appends .encrypted suffix when derivedKey is provided", () => {
    const files = [`${HOME}/.zshrc`];
    copyToStaging(files, MACHINE, mockDerivedKey);

    expect(fs.readFileSync).toHaveBeenCalledWith(`${HOME}/.zshrc`);
    expect(mockEncrypt).toHaveBeenCalledWith(Buffer.from("file content"), mockDerivedKey);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      getStagedPath(`${HOME}/.zshrc`, MACHINE) + ".encrypted",
      expect.any(Buffer),
    );
  });

  it("uses copyFileSync when no derivedKey is provided", () => {
    const files = [`${HOME}/.zshrc`];
    copyToStaging(files, MACHINE);

    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(fs.copyFileSync).toHaveBeenCalled();
  });

  it("excludes the key file from backup", () => {
    const files = [`${HOME}/.zshrc`, "/mock-home/.backdot/encryption.key"];
    copyToStaging(files, MACHINE, mockDerivedKey);

    expect(mockEncrypt).toHaveBeenCalledTimes(1);
  });

  it("excludes the GitHub token file from backup", () => {
    const files = [`${HOME}/.zshrc`, TOKEN_FILE_PATH];
    copyToStaging(files, MACHINE);

    expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      `${HOME}/.zshrc`,
      getStagedPath(`${HOME}/.zshrc`, MACHINE),
    );
    expect(fs.copyFileSync).not.toHaveBeenCalledWith(
      TOKEN_FILE_PATH,
      getStagedPath(TOKEN_FILE_PATH, MACHINE),
    );
  });
});

describe("writeRepoReadme with encryption", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("includes encryption note when encrypted is true", () => {
    writeRepoReadme(REPO, true);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(STAGING_DIR, "README.md"),
      expect.stringContaining("encrypted"),
    );
  });

  it("does not include encryption note when encrypted is false", () => {
    writeRepoReadme(REPO, false);

    const content = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(content).not.toContain("encrypted");
  });
});

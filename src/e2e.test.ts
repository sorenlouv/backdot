import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execSync, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_PATH = path.resolve(import.meta.dirname, "../dist/cli.js");

function run(args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  if (result.status !== 0) {
    throw new Error(`CLI exited with code ${result.status}:\n${combined}`);
  }
  return combined;
}

async function runAsync(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, ...args], {
    env,
    timeout: 30_000,
  });
  return (stdout ?? "") + (stderr ?? "");
}

function cloneRemote(repo: string, dest: string): void {
  execSync(`git clone "${repo}" "${dest}"`, { stdio: "ignore" });
}

function testEnv(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    GIT_AUTHOR_NAME: "backdot-test",
    GIT_AUTHOR_EMAIL: "test@backdot.dev",
    GIT_COMMITTER_NAME: "backdot-test",
    GIT_COMMITTER_EMAIL: "test@backdot.dev",
  };
}

describe("backdot --init", () => {
  let initDir: string;
  let initEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    initDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-init-"));
    initEnv = { ...process.env, HOME: initDir };
  });

  afterAll(() => {
    fs.rmSync(initDir, { recursive: true, force: true });
  });

  it("creates ~/.backdot.json with defaults", () => {
    const output = run(["--init"], initEnv);
    expect(output).toContain("Welcome to backdot");
    expect(output).toContain(".backdot.json with defaults");

    const configPath = path.join(initDir, ".backdot.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.repository).toBe("git@github.com:USERNAME/backdot-backup.git");
    expect(config.machine).toBe(os.hostname());
    expect(config.paths).toEqual(["~/.zshrc", "~/.gitconfig"]);
  });

  it("does not overwrite existing config on second run", () => {
    const configPath = path.join(initDir, ".backdot.json");
    const before = fs.readFileSync(configPath, "utf-8");

    const output = run(["--init"], initEnv);
    expect(output).toContain("already exists");

    const after = fs.readFileSync(configPath, "utf-8");
    expect(after).toBe(before);
  });
});

describe("backdot e2e", () => {
  let tempDir: string;
  let remoteRepo: string;
  let env: NodeJS.ProcessEnv;

  const ZSHRC_CONTENT = 'export PATH="/usr/local/bin:$PATH"\n';
  const SETTINGS_CONTENT = '{"theme":"dark"}\n';
  const MODIFIED_ZSHRC = "# modified by e2e test\n";

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-e2e-"));

    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.writeFileSync(path.join(tempDir, ".zshrc"), ZSHRC_CONTENT);
    fs.mkdirSync(path.join(tempDir, ".config", "test"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".config", "test", "settings.json"), SETTINGS_CONTENT);

    fs.writeFileSync(
      path.join(tempDir, ".backdot.json"),
      JSON.stringify(
        {
          repository: remoteRepo,
          machine: "test-machine",
          paths: ["~/.zshrc", "~/.config/test/**"],
        },
        null,
        2,
      ),
    );

    env = testEnv(tempDir);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("--version prints a semver string", () => {
    const output = run(["--version"], env);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--backup succeeds and pushes files to the remote repo", () => {
    const output = run(["--backup"], env);
    expect(output).toContain("Backup complete");

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    expect(fs.existsSync(path.join(verifyDir, "test-machine", ".zshrc"))).toBe(true);
    expect(
      fs.existsSync(path.join(verifyDir, "test-machine", ".config", "test", "settings.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, "test-machine", ".backdot.json"))).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, "README.md"))).toBe(true);

    expect(fs.readFileSync(path.join(verifyDir, "test-machine", ".zshrc"), "utf-8")).toBe(
      ZSHRC_CONTENT,
    );

    fs.rmSync(verifyDir, { recursive: true, force: true });
  });

  it("--backup with no changes still succeeds", () => {
    const output = run(["--backup"], env);
    expect(output).toContain("Backup complete");
  });

  it("--status shows all files as backed up", () => {
    const output = run(["--status"], env);
    expect(output).toContain("backed up");
    expect(output).not.toContain("Modified");
    expect(output).not.toContain("Not yet backed up");
  });

  it("--status detects a modified file", () => {
    fs.writeFileSync(path.join(tempDir, ".zshrc"), MODIFIED_ZSHRC);

    const output = run(["--status"], env);
    expect(output).toContain("Modified");
  });

  it("--backup after modification pushes the change", () => {
    const output = run(["--backup"], env);
    expect(output).toContain("Backup complete");
  });

  it("--status shows all files backed up after second backup", () => {
    const output = run(["--status"], env);
    expect(output).toContain("backed up");
    expect(output).not.toContain("Modified");
  });

  it("--restore recovers deleted files", () => {
    fs.unlinkSync(path.join(tempDir, ".zshrc"));
    fs.unlinkSync(path.join(tempDir, ".config", "test", "settings.json"));
    fs.unlinkSync(path.join(tempDir, ".backdot.json"));

    const output = run(["--restore", remoteRepo, "--yes"], env);
    expect(output).toContain("Restored");

    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(MODIFIED_ZSHRC);
    expect(fs.readFileSync(path.join(tempDir, ".config", "test", "settings.json"), "utf-8")).toBe(
      SETTINGS_CONTENT,
    );
  });

  it("--restore --commit restores from a specific earlier backup", () => {
    const verifyDir = path.join(tempDir, "verify-log");
    cloneRemote(remoteRepo, verifyDir);
    const firstCommitSha = execSync("git rev-list --reverse HEAD | head -n 1", {
      cwd: verifyDir,
      encoding: "utf-8",
    }).trim();
    fs.rmSync(verifyDir, { recursive: true, force: true });

    fs.unlinkSync(path.join(tempDir, ".zshrc"));
    fs.unlinkSync(path.join(tempDir, ".config", "test", "settings.json"));
    fs.unlinkSync(path.join(tempDir, ".backdot.json"));

    const output = run(["--restore", remoteRepo, "--commit", firstCommitSha, "--yes"], env);
    expect(output).toContain("Restored");

    // The first commit had the original ZSHRC_CONTENT, not the MODIFIED_ZSHRC
    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(ZSHRC_CONTENT);
  });
});

describe("negation patterns", () => {
  let tempDir: string;
  let remoteRepo: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-negate-"));

    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.mkdirSync(path.join(tempDir, ".config", "app"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".config", "app", "config.json"), '{"a":1}\n');
    fs.writeFileSync(path.join(tempDir, ".config", "app", "secret.key"), "supersecret\n");
    fs.writeFileSync(path.join(tempDir, ".config", "app", "cache.tmp"), "cached\n");

    fs.writeFileSync(
      path.join(tempDir, ".backdot.json"),
      JSON.stringify(
        {
          repository: remoteRepo,
          machine: "negate-machine",
          paths: ["~/.config/app/*", "!~/.config/app/secret.key", "!~/.config/app/cache.tmp"],
        },
        null,
        2,
      ),
    );

    env = testEnv(tempDir);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("--backup excludes files matching negation patterns", () => {
    const output = run(["--backup"], env);
    expect(output).toContain("Backup complete");

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    const machineDir = path.join(verifyDir, "negate-machine");

    expect(fs.existsSync(path.join(machineDir, ".config", "app", "config.json"))).toBe(true);

    expect(fs.existsSync(path.join(machineDir, ".config", "app", "secret.key"))).toBe(false);
    expect(fs.existsSync(path.join(machineDir, ".config", "app", "cache.tmp"))).toBe(false);

    fs.rmSync(verifyDir, { recursive: true, force: true });
  });
});

describe("concurrent multi-machine backup", () => {
  let tempDir: string;
  let remoteRepo: string;

  const machines = [
    { name: "laptop", file: ".zshrc", content: "# laptop zshrc\n" },
    { name: "desktop", file: ".zshrc", content: "# desktop zshrc\n" },
    { name: "server", file: ".bashrc", content: "# server bashrc\n" },
  ];

  function envForMachine(name: string): NodeJS.ProcessEnv {
    return testEnv(path.join(tempDir, name));
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-concurrent-"));

    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare -b main "${remoteRepo}"`, { stdio: "ignore" });

    for (const m of machines) {
      const homeDir = path.join(tempDir, m.name);
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(path.join(homeDir, m.file), m.content);
      fs.writeFileSync(
        path.join(homeDir, ".backdot.json"),
        JSON.stringify(
          { repository: remoteRepo, machine: m.name, paths: [`~/${m.file}`] },
          null,
          2,
        ),
      );
    }

    // Seed the repo sequentially so all machines exist on the remote
    for (const m of machines) {
      run(["--backup"], envForMachine(m.name));
    }
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("all machines succeed when backing up concurrently", async () => {
    // Modify every machine's file so each has something new to push
    for (const m of machines) {
      const homeDir = path.join(tempDir, m.name);
      fs.writeFileSync(path.join(homeDir, m.file), `${m.content}# updated\n`);
    }

    const results = await Promise.all(
      machines.map((m) => runAsync(["--backup"], envForMachine(m.name))),
    );

    for (const output of results) {
      expect(output).toContain("Backup complete");
    }

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    for (const m of machines) {
      const filePath = path.join(verifyDir, m.name, m.file);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(`${m.content}# updated\n`);
    }

    fs.rmSync(verifyDir, { recursive: true, force: true });
  }, 60_000);
});

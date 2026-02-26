import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    expect(output).toContain("Created ~/.backdot.json");

    const configPath = path.join(initDir, ".backdot.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.repository).toBe("git@github.com:USERNAME/backdot-backup.git");
    expect(config.machine).toBe(os.hostname());
    expect(config["files.match"]).toEqual(["~/.zshrc", "~/.gitconfig"]);
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
          "files.match": ["~/.zshrc", "~/.config/test/**"],
        },
        null,
        2,
      ),
    );

    env = {
      ...process.env,
      HOME: tempDir,
      GIT_AUTHOR_NAME: "backdot-test",
      GIT_AUTHOR_EMAIL: "test@backdot.dev",
      GIT_COMMITTER_NAME: "backdot-test",
      GIT_COMMITTER_EMAIL: "test@backdot.dev",
    };
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
    execSync(`git clone "${remoteRepo}" "${verifyDir}"`, { stdio: "ignore" });

    expect(fs.existsSync(path.join(verifyDir, "test-machine", ".zshrc"))).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, "test-machine", ".config", "test", "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, "test-machine", ".backdot.json"))).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, "README.md"))).toBe(true);

    expect(fs.readFileSync(path.join(verifyDir, "test-machine", ".zshrc"), "utf-8")).toBe(ZSHRC_CONTENT);

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

    const output = run(["--restore", remoteRepo], env);
    expect(output).toContain("Restored");

    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(MODIFIED_ZSHRC);
    expect(fs.readFileSync(path.join(tempDir, ".config", "test", "settings.json"), "utf-8")).toBe(SETTINGS_CONTENT);
  });
});

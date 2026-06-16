import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execSync, execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_PATH = path.resolve(import.meta.dirname, "../dist/cli.js");

// backdot is GitHub-only over HTTPS now, so config.repository must be a
// github.com URL. To keep these tests offline we (1) point the GitHub REST
// check at a local stub via BACKDOT_GITHUB_API, and (2) rewrite this URL to a
// local bare repo per-HOME with git's `insteadOf`. The CLI never knows the
// difference; verification clones use the local path directly.
const GH_URL = "https://github.com/backdot-test/backup.git";

// The GitHub REST stub (GET /repos/:owner/:repo -> {private:true}) MUST run in
// its OWN process: run() uses spawnSync, which blocks this worker's event loop,
// so an in-process server could never answer the CLI's request (deadlock).
const STUB_SERVER = `
  const http = require('node:http');
  const s = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ private: true }));
  });
  s.listen(0, '127.0.0.1', () => process.stdout.write('PORT:' + s.address().port + '\\n'));
`;

let apiProc: ChildProcess;
let apiBaseUrl: string;

beforeAll(async () => {
  apiProc = spawn("node", ["-e", STUB_SERVER], { stdio: ["ignore", "pipe", "ignore"] });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stub server did not start in time")), 10_000);
    let buf = "";
    apiProc.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/PORT:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    apiProc.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  apiBaseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  apiProc.kill();
});

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

// Routes GH_URL to a local bare repo for git operations run with HOME=homeDir.
function routeToLocal(homeDir: string, localRepo: string): void {
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(
    path.join(homeDir, ".gitconfig"),
    `[url "${localRepo}"]\n\tinsteadOf = ${GH_URL}\n`,
  );
}

function testEnv(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    // BACKDOT_GITHUB_API is honored only under NODE_ENV=test (a test-only seam).
    NODE_ENV: "test",
    BACKDOT_GITHUB_API: apiBaseUrl,
    BACKDOT_GITHUB_TOKEN: "test-token",
    GIT_AUTHOR_NAME: "backdot-test",
    GIT_AUTHOR_EMAIL: "test@backdot.dev",
    GIT_COMMITTER_NAME: "backdot-test",
    GIT_COMMITTER_EMAIL: "test@backdot.dev",
  };
}

describe("backdot init", () => {
  let initDir: string;
  let initEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    initDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-init-"));
    initEnv = { ...process.env, HOME: initDir };
  });

  afterAll(() => {
    fs.rmSync(initDir, { recursive: true, force: true });
  });

  it("creates ~/.backdot/config.json with defaults", () => {
    const output = run(["init"], initEnv);
    expect(output).toContain("Welcome to backdot");
    expect(output).toContain("config.json with defaults");

    const configPath = path.join(initDir, ".backdot", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.repository).toBe("https://github.com/USERNAME/backdot-backup.git");
    expect(config.machine).toBe(
      process.platform === "darwin"
        ? execSync("scutil --get LocalHostName", { encoding: "utf-8" }).trim()
        : os.hostname().replace(/\.(local|localdomain)$/, ""),
    );
    expect(config.paths).toEqual(["~/.zshrc", "~/.gitconfig"]);
  });

  it("does not overwrite existing config on second run", () => {
    const configPath = path.join(initDir, ".backdot", "config.json");
    const before = fs.readFileSync(configPath, "utf-8");

    const output = run(["init"], initEnv);
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

    fs.mkdirSync(path.join(tempDir, ".backdot"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".backdot", "config.json"),
      JSON.stringify(
        {
          repository: GH_URL,
          machine: "test-machine",
          paths: ["~/.zshrc", "~/.config/test/**"],
        },
        null,
        2,
      ),
    );
    routeToLocal(tempDir, remoteRepo);

    env = testEnv(tempDir);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("version prints a version string", () => {
    const output = run(["--version"], env);
    expect(output).toMatch(/backdot\/\d+\.\d+\.\d+/);
  });

  it("backup succeeds and pushes files to the remote repo", () => {
    const output = run(["backup"], env);
    expect(output).toContain("Backup complete");

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    expect(fs.existsSync(path.join(verifyDir, "test-machine", "home", ".zshrc"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(verifyDir, "test-machine", "home", ".config", "test", "settings.json"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(verifyDir, "test-machine", "home", ".backdot", "config.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, "README.md"))).toBe(true);

    expect(fs.readFileSync(path.join(verifyDir, "test-machine", "home", ".zshrc"), "utf-8")).toBe(
      ZSHRC_CONTENT,
    );

    fs.rmSync(verifyDir, { recursive: true, force: true });
  });

  it("backup with no changes still succeeds and records an empty commit", () => {
    const countCommits = (suffix: string): number => {
      const verifyDir = path.join(tempDir, `verify-count-${suffix}`);
      cloneRemote(remoteRepo, verifyDir);
      const count = Number(
        execSync("git rev-list --count HEAD", { cwd: verifyDir, encoding: "utf-8" }).trim(),
      );
      fs.rmSync(verifyDir, { recursive: true, force: true });
      return count;
    };

    const before = countCommits("before");
    const output = run(["backup"], env);
    expect(output).toContain("Backup complete");

    const verifyDir = path.join(tempDir, "verify-empty");
    cloneRemote(remoteRepo, verifyDir);
    const after = Number(
      execSync("git rev-list --count HEAD", { cwd: verifyDir, encoding: "utf-8" }).trim(),
    );
    const latestMessage = execSync("git log -1 --format=%s", {
      cwd: verifyDir,
      encoding: "utf-8",
    }).trim();
    fs.rmSync(verifyDir, { recursive: true, force: true });

    // A new (empty) commit was pushed, signalling the backup ran.
    expect(after).toBe(before + 1);
    expect(latestMessage).toBe("backup: no changes");
  });

  it("status shows all files as backed up", () => {
    const output = run(["status"], env);
    expect(output).toContain("backed up");
    expect(output).not.toContain("Modified");
    expect(output).not.toContain("Not yet backed up");
  });

  it("status detects a modified file", () => {
    fs.writeFileSync(path.join(tempDir, ".zshrc"), MODIFIED_ZSHRC);

    const output = run(["status"], env);
    expect(output).toContain("Modified");
  });

  it("backup after modification pushes the change", () => {
    const output = run(["backup"], env);
    expect(output).toContain("Backup complete");
  });

  it("status shows all files backed up after second backup", () => {
    const output = run(["status"], env);
    expect(output).toContain("backed up");
    expect(output).not.toContain("Modified");
  });

  it("restore recovers deleted files", () => {
    fs.unlinkSync(path.join(tempDir, ".zshrc"));
    fs.unlinkSync(path.join(tempDir, ".config", "test", "settings.json"));
    fs.unlinkSync(path.join(tempDir, ".backdot", "config.json"));

    const output = run(["restore", GH_URL, "--no-overwrite"], env);
    expect(output).toContain("Restored");

    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(MODIFIED_ZSHRC);
    expect(fs.readFileSync(path.join(tempDir, ".config", "test", "settings.json"), "utf-8")).toBe(
      SETTINGS_CONTENT,
    );
  });

  it("restore --commit restores from a specific earlier backup", () => {
    const verifyDir = path.join(tempDir, "verify-log");
    cloneRemote(remoteRepo, verifyDir);
    const firstCommitSha = execSync("git rev-list --reverse HEAD | head -n 1", {
      cwd: verifyDir,
      encoding: "utf-8",
    }).trim();
    fs.rmSync(verifyDir, { recursive: true, force: true });

    fs.unlinkSync(path.join(tempDir, ".zshrc"));
    fs.unlinkSync(path.join(tempDir, ".config", "test", "settings.json"));
    fs.unlinkSync(path.join(tempDir, ".backdot", "config.json"));

    const output = run(["restore", GH_URL, "--commit", firstCommitSha, "--no-overwrite"], env);
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

    fs.mkdirSync(path.join(tempDir, ".backdot"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".backdot", "config.json"),
      JSON.stringify(
        {
          repository: GH_URL,
          machine: "negate-machine",
          paths: ["~/.config/app/*", "!~/.config/app/secret.key", "!~/.config/app/cache.tmp"],
        },
        null,
        2,
      ),
    );
    routeToLocal(tempDir, remoteRepo);

    env = testEnv(tempDir);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("backup excludes files matching negation patterns", () => {
    const output = run(["backup"], env);
    expect(output).toContain("Backup complete");

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    const machineDir = path.join(verifyDir, "negate-machine", "home");

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
      fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
      fs.writeFileSync(path.join(homeDir, m.file), m.content);
      fs.writeFileSync(
        path.join(homeDir, ".backdot", "config.json"),
        JSON.stringify({ repository: GH_URL, machine: m.name, paths: [`~/${m.file}`] }, null, 2),
      );
      routeToLocal(homeDir, remoteRepo);
    }

    // Seed the repo sequentially so all machines exist on the remote
    for (const m of machines) {
      run(["backup"], envForMachine(m.name));
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
      machines.map((m) => runAsync(["backup"], envForMachine(m.name))),
    );

    for (const output of results) {
      expect(output).toContain("Backup complete");
    }

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    for (const m of machines) {
      const filePath = path.join(verifyDir, m.name, "home", m.file);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(`${m.content}# updated\n`);
    }

    fs.rmSync(verifyDir, { recursive: true, force: true });
  }, 60_000);
});

describe("encrypted backup and restore", () => {
  let tempDir: string;
  let remoteRepo: string;
  let env: NodeJS.ProcessEnv;

  const ZSHRC_CONTENT = "# encrypted zshrc test\n";
  const PASSWORD = "test-e2e-password";

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-enc-"));

    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.writeFileSync(path.join(tempDir, ".zshrc"), ZSHRC_CONTENT);

    fs.mkdirSync(path.join(tempDir, ".backdot"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".backdot", "config.json"),
      JSON.stringify(
        {
          repository: GH_URL,
          machine: "enc-machine",
          paths: ["~/.zshrc"],
          encrypt: true,
        },
        null,
        2,
      ),
    );
    routeToLocal(tempDir, remoteRepo);

    env = {
      ...testEnv(tempDir),
      BACKDOT_PASSWORD: PASSWORD,
    };
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("backup encrypts files with .encrypted suffix in the remote repo", () => {
    const output = run(["backup"], env);
    expect(output).toContain("Backup complete");

    const verifyDir = path.join(tempDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);

    const plaintextFile = path.join(verifyDir, "enc-machine", "home", ".zshrc");
    expect(fs.existsSync(plaintextFile)).toBe(false);

    const encryptedFile = path.join(verifyDir, "enc-machine", "home", ".zshrc.encrypted");
    expect(fs.existsSync(encryptedFile)).toBe(true);

    const content = fs.readFileSync(encryptedFile);
    expect(content.length).toBeGreaterThan(60); // salt(32) + iv(12) + tag(16) + ciphertext
    expect(content.toString("utf-8")).not.toContain("encrypted zshrc test");

    const readme = fs.readFileSync(path.join(verifyDir, "README.md"), "utf-8");
    expect(readme).toContain("encrypted");

    fs.rmSync(verifyDir, { recursive: true, force: true });
  });

  it("restore decrypts files back to plaintext", () => {
    fs.unlinkSync(path.join(tempDir, ".zshrc"));
    fs.unlinkSync(path.join(tempDir, ".backdot", "config.json"));

    const output = run(["restore", GH_URL, "--no-overwrite"], env);
    expect(output).toContain("Restored");

    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(ZSHRC_CONTENT);
  });

  it("backup with wrong password fails when repo has existing encrypted files", () => {
    const wrongEnv = { ...env, BACKDOT_PASSWORD: "wrong-password" };

    expect(() => run(["backup"], wrongEnv)).toThrow("Password does not match");
  });

  it("status works with encryption", () => {
    const output = run(["status"], env);
    expect(output).toContain("backed up");
  });
});

describe("files outside HOME round-trip", () => {
  let homeDir: string;
  let outsideDir: string;
  let remoteRepo: string;
  let env: NodeJS.ProcessEnv;

  const OUTSIDE_CONTENT = "# system-level config\n";

  beforeAll(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-home-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-outside-"));

    remoteRepo = path.join(homeDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.writeFileSync(path.join(outsideDir, "system.conf"), OUTSIDE_CONTENT);

    fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".backdot", "config.json"),
      JSON.stringify(
        {
          repository: GH_URL,
          machine: "outside-machine",
          paths: [path.join(outsideDir, "system.conf")],
        },
        null,
        2,
      ),
    );
    routeToLocal(homeDir, remoteRepo);

    env = testEnv(homeDir);
  });

  afterAll(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("stores files outside HOME under root/ and restores them to their absolute path", () => {
    expect(run(["backup"], env)).toContain("Backup complete");

    const verifyDir = path.join(homeDir, "verify-clone");
    cloneRemote(remoteRepo, verifyDir);
    // Files outside HOME use the root/ namespace, never home/.
    expect(fs.existsSync(path.join(verifyDir, "outside-machine", "root"))).toBe(true);
    fs.rmSync(verifyDir, { recursive: true, force: true });

    // Delete the original, then restore: it must come back at the same absolute
    // path, not somewhere under HOME.
    fs.rmSync(outsideDir, { recursive: true, force: true });
    expect(run(["restore", GH_URL, "--no-overwrite"], env)).toContain("Restored");

    expect(fs.readFileSync(path.join(outsideDir, "system.conf"), "utf-8")).toBe(OUTSIDE_CONTENT);
  });
});

describe("backup with no matching files", () => {
  it("warns, still backs up the config, and records a commit", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-nomatch-"));
    try {
      const remoteRepo = path.join(homeDir, "remote.git");
      execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

      // Config is valid, but its paths match nothing on disk (e.g. a fresh
      // machine where these dotfiles don't exist yet).
      fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, ".backdot", "config.json"),
        JSON.stringify(
          { repository: GH_URL, machine: "lonely", paths: ["~/.does-not-exist"] },
          null,
          2,
        ),
      );
      routeToLocal(homeDir, remoteRepo);

      const output = run(["backup"], testEnv(homeDir));
      // It does not bail out — it warns and completes.
      expect(output).toContain("backing up config only");
      expect(output).toContain("Backup complete");

      const verifyDir = path.join(homeDir, "verify-clone");
      cloneRemote(remoteRepo, verifyDir);
      // The config is still backed up (the "config always backed up" invariant),
      // and the run produced a commit rather than a silent no-op.
      expect(fs.existsSync(path.join(verifyDir, "lonely", "home", ".backdot", "config.json"))).toBe(
        true,
      );
      const commitCount = Number(
        execSync("git rev-list --count HEAD", { cwd: verifyDir, encoding: "utf-8" }).trim(),
      );
      expect(commitCount).toBe(1);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("status before first backup", () => {
  it("nudges to run init when there is no config", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-noconfig-"));
    try {
      const output = run(["status"], testEnv(homeDir));
      expect(output).toContain("No config found");
      expect(output).toContain("backdot init");
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("previews what would be backed up when nothing has been backed up yet", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-prebackup-"));
    try {
      const remoteRepo = path.join(homeDir, "remote.git");
      execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

      fs.writeFileSync(path.join(homeDir, ".zshrc"), "# zshrc\n");
      fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, ".backdot", "config.json"),
        JSON.stringify({ repository: GH_URL, machine: "fresh", paths: ["~/.zshrc"] }, null, 2),
      );
      routeToLocal(homeDir, remoteRepo);

      const output = run(["status"], testEnv(homeDir));
      expect(output).toContain("No backup yet");
      expect(output).toContain("Not yet backed up");
      expect(output).toContain(".zshrc");
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("restore --machine", () => {
  let tempDir: string;
  let remoteRepo: string;

  const machines = [
    { name: "laptop", file: ".zshrc", content: "# laptop\n" },
    { name: "server", file: ".bashrc", content: "# server\n" },
  ];

  // Captures the failure message of a command expected to exit non-zero.
  function failureOutput(args: string[], env: NodeJS.ProcessEnv): string {
    try {
      run(args, env);
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error("expected the command to fail, but it succeeded");
  }

  // A fresh, config-less HOME that can still reach the remote and the API stub.
  function freshEnv(): { home: string; env: NodeJS.ProcessEnv } {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-fresh-"));
    routeToLocal(home, remoteRepo);
    return { home, env: testEnv(home) };
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-machineflag-"));
    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare -b main "${remoteRepo}"`, { stdio: "ignore" });

    for (const m of machines) {
      const homeDir = path.join(tempDir, m.name);
      fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
      fs.writeFileSync(path.join(homeDir, m.file), m.content);
      fs.writeFileSync(
        path.join(homeDir, ".backdot", "config.json"),
        JSON.stringify({ repository: GH_URL, machine: m.name, paths: [`~/${m.file}`] }, null, 2),
      );
      routeToLocal(homeDir, remoteRepo);
      run(["backup"], testEnv(homeDir));
    }
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("restores the named machine into a config-less HOME", () => {
    const { home, env } = freshEnv();
    try {
      const output = run(["restore", GH_URL, "--machine", "server", "--no-overwrite"], env);
      expect(output).toContain("Restored");
      expect(fs.readFileSync(path.join(home, ".bashrc"), "utf-8")).toBe("# server\n");
      expect(fs.existsSync(path.join(home, ".zshrc"))).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("errors and lists machines when --machine names an unknown machine", () => {
    const { home, env } = freshEnv();
    try {
      const message = failureOutput(
        ["restore", GH_URL, "--machine", "nope", "--no-overwrite"],
        env,
      );
      expect(message).toContain('No backup found for machine "nope"');
      expect(message).toContain("laptop");
      expect(message).toContain("server");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("errors and lists machines when multiple exist, no --machine, and no TTY", () => {
    const { home, env } = freshEnv();
    try {
      const message = failureOutput(["restore", GH_URL, "--no-overwrite"], env);
      expect(message).toContain("Multiple machines found");
      expect(message).toContain("--machine");
      expect(message).toContain("laptop");
      expect(message).toContain("server");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("errors with a clear message when restore runs without --yes in a non-TTY", () => {
    const { home, env } = freshEnv();
    try {
      const message = failureOutput(["restore", GH_URL, "--machine", "laptop"], env);
      expect(message).toContain("interactive");
      expect(message).toContain("--yes");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("errors with a clear message when history runs in a non-TTY", () => {
    const { home, env } = freshEnv();
    try {
      const message = failureOutput(["history", GH_URL], env);
      expect(message).toContain("interactive");
      expect(message).toContain("restore --commit");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("post-restore hook", () => {
  // Sets up a machine with a ~/.backdot/post-restore script, backs it up, then
  // wipes the home dir to simulate a fresh machine ready to restore.
  function setupBackedUpMachine(hookScript: string): { homeDir: string } {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-hook-"));
    const remoteRepo = path.join(homeDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.writeFileSync(path.join(homeDir, ".zshrc"), "# zshrc\n");
    fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
    fs.writeFileSync(path.join(homeDir, ".backdot", "post-restore"), hookScript);
    fs.writeFileSync(
      path.join(homeDir, ".backdot", "config.json"),
      JSON.stringify({ repository: GH_URL, machine: "box", paths: ["~/.zshrc"] }, null, 2),
    );
    routeToLocal(homeDir, remoteRepo);

    run(["backup"], testEnv(homeDir));

    // Simulate a wiped machine: only the remote (and routing) survive.
    fs.rmSync(path.join(homeDir, ".zshrc"));
    fs.rmSync(path.join(homeDir, ".backdot"), { recursive: true });

    return { homeDir };
  }

  it("runs the restored hook after restoring", () => {
    const { homeDir } = setupBackedUpMachine('touch "$HOME/provisioned"\n');
    try {
      const output = run(
        ["restore", GH_URL, "--machine", "box", "--no-overwrite"],
        testEnv(homeDir),
      );

      expect(output).toContain("Restored");
      expect(output).toContain("post-restore hook");
      expect(fs.existsSync(path.join(homeDir, "provisioned"))).toBe(true);
      expect(fs.existsSync(path.join(homeDir, ".zshrc"))).toBe(true);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("surfaces a failing hook as an error, with files already restored", () => {
    const { homeDir } = setupBackedUpMachine("exit 3\n");
    try {
      let message = "";
      try {
        run(["restore", GH_URL, "--machine", "box", "--no-overwrite"], testEnv(homeDir));
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain("post-restore hook failed");
      expect(message).toContain("exit code 3");
      // The file restore completed before the hook ran.
      expect(fs.existsSync(path.join(homeDir, ".zshrc"))).toBe(true);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("user-authored files in the machine dir", () => {
  it("preserves <machine>/README.md across backups and never restores it", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-userdoc-"));
    try {
      const remoteRepo = path.join(homeDir, "remote.git");
      execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

      fs.writeFileSync(path.join(homeDir, ".zshrc"), "# zshrc\n");
      fs.mkdirSync(path.join(homeDir, ".backdot"), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, ".backdot", "config.json"),
        JSON.stringify({ repository: GH_URL, machine: "box", paths: ["~/.zshrc"] }, null, 2),
      );
      routeToLocal(homeDir, remoteRepo);

      run(["backup"], testEnv(homeDir));

      // The user adds box/README.md directly to the repo (web UI or a clone).
      const editClone = path.join(homeDir, "edit-clone");
      cloneRemote(remoteRepo, editClone);
      const NOTES = "# Restore notes for box\n\nRun ./provision.sh after restoring.\n";
      fs.writeFileSync(path.join(editClone, "box", "README.md"), NOTES);
      execSync(`git -C "${editClone}" add -A`, { stdio: "ignore" });
      execSync(
        `git -C "${editClone}" -c user.name=u -c user.email=u@e.dev commit -m "add restore notes"`,
        { stdio: "ignore" },
      );
      execSync(`git -C "${editClone}" push`, { stdio: "ignore" });

      // A subsequent backup must not delete the user's README.
      fs.writeFileSync(path.join(homeDir, ".zshrc"), "# changed\n");
      run(["backup"], testEnv(homeDir));

      const verify = path.join(homeDir, "verify");
      cloneRemote(remoteRepo, verify);
      expect(fs.readFileSync(path.join(verify, "box", "README.md"), "utf-8")).toBe(NOTES);
      // The payload was still updated.
      expect(fs.readFileSync(path.join(verify, "box", "home", ".zshrc"), "utf-8")).toBe(
        "# changed\n",
      );

      // Restore treats the README as docs: the payload comes back, the README never does.
      fs.rmSync(path.join(homeDir, ".zshrc"));
      run(["restore", GH_URL, "--machine", "box", "--no-overwrite"], testEnv(homeDir));
      expect(fs.existsSync(path.join(homeDir, ".zshrc"))).toBe(true);
      expect(fs.existsSync(path.join(homeDir, "README.md"))).toBe(false);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("restore --dry-run", () => {
  let tempDir: string;
  let remoteRepo: string;
  let env: NodeJS.ProcessEnv;

  const ORIGINAL_ZSHRC = "# original zshrc\n";
  const LOCAL_EDIT = "# locally edited zshrc\n";
  const SETTINGS = '{"theme":"dark"}\n';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-dryrun-"));
    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.writeFileSync(path.join(tempDir, ".zshrc"), ORIGINAL_ZSHRC);
    fs.mkdirSync(path.join(tempDir, ".config", "test"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".config", "test", "settings.json"), SETTINGS);

    fs.mkdirSync(path.join(tempDir, ".backdot"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".backdot", "config.json"),
      JSON.stringify(
        {
          repository: GH_URL,
          machine: "dry-machine",
          paths: ["~/.zshrc", "~/.config/test/**"],
        },
        null,
        2,
      ),
    );
    routeToLocal(tempDir, remoteRepo);
    env = testEnv(tempDir);

    run(["backup"], env);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("previews creates and overwrites with a diff, writing nothing, and works in a non-TTY", () => {
    // One backed-up file now diverges locally; another is missing locally (so a
    // real restore would create it).
    fs.writeFileSync(path.join(tempDir, ".zshrc"), LOCAL_EDIT);
    fs.rmSync(path.join(tempDir, ".config", "test", "settings.json"));

    // No --no-overwrite, yet this must NOT throw the "interactive" error in a
    // non-TTY: dry-run returns before the picker.
    const output = run(["restore", GH_URL, "--dry-run"], env);

    expect(output).toContain("Dry run");
    expect(output).toContain("no files will be written");

    expect(output).toContain("will be created");
    expect(output).toContain("settings.json");

    expect(output).toContain("overwrites your local copy");
    // The unified diff shows the local line (removed) and the backup line (added).
    expect(output).toContain("locally edited zshrc");
    expect(output).toContain("original zshrc");

    // Nothing was written: the edited file is untouched and the deleted file was
    // not recreated.
    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(LOCAL_EDIT);
    expect(fs.existsSync(path.join(tempDir, ".config", "test", "settings.json"))).toBe(false);
  });

  it("reports existing files as left untouched with --no-overwrite", () => {
    // .zshrc is still the local edit from the previous test, so it is "existing".
    const output = run(["restore", GH_URL, "--dry-run", "--no-overwrite"], env);
    expect(output).toContain("left untouched");
    expect(output).toContain("will be created");
    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(LOCAL_EDIT);
    expect(fs.existsSync(path.join(tempDir, ".config", "test", "settings.json"))).toBe(false);
  });
});

describe("restore --dry-run with encryption", () => {
  let tempDir: string;
  let remoteRepo: string;
  let env: NodeJS.ProcessEnv;

  const ORIGINAL = "# original secret\n";
  const LOCAL_EDIT = "# tampered secret\n";
  const PASSWORD = "dry-run-enc-password";

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-dryrun-enc-"));
    remoteRepo = path.join(tempDir, "remote.git");
    execSync(`git init --bare "${remoteRepo}"`, { stdio: "ignore" });

    fs.writeFileSync(path.join(tempDir, ".zshrc"), ORIGINAL);
    fs.mkdirSync(path.join(tempDir, ".backdot"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".backdot", "config.json"),
      JSON.stringify(
        { repository: GH_URL, machine: "enc-dry", paths: ["~/.zshrc"], encrypt: true },
        null,
        2,
      ),
    );
    routeToLocal(tempDir, remoteRepo);
    env = { ...testEnv(tempDir), BACKDOT_PASSWORD: PASSWORD };

    run(["backup"], env);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("decrypts the backup to diff an encrypted file, writing nothing", () => {
    fs.writeFileSync(path.join(tempDir, ".zshrc"), LOCAL_EDIT);

    const output = run(["restore", GH_URL, "--dry-run"], env);

    expect(output).toContain("overwrites your local copy");
    // The diff is computed from decrypted backup content, not ciphertext.
    expect(output).toContain("tampered secret");
    expect(output).toContain("original secret");

    expect(fs.readFileSync(path.join(tempDir, ".zshrc"), "utf-8")).toBe(LOCAL_EDIT);
  });
});

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let STAGING: string;

vi.mock("./paths.js", () => ({
  get STAGING_DIR() {
    return STAGING;
  },
  get STAGING_GIT_DIR() {
    return `${STAGING}/.git`;
  },
}));

vi.mock("./log.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ensureRemoteUrl, gitPull, gitLog, gitCommitAndPush } from "./git.js";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "backdot-test",
  GIT_AUTHOR_EMAIL: "test@backdot.dev",
  GIT_COMMITTER_NAME: "backdot-test",
  GIT_COMMITTER_EMAIL: "test@backdot.dev",
};

function createBareRepo(dir: string): void {
  execSync(`git init --bare "${dir}"`, { stdio: "ignore" });
}

function addCommitToRemote(remoteDir: string, filename: string, content: string): string {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-work-"));
  try {
    execSync(`git clone "${remoteDir}" "${workDir}/repo"`, {
      stdio: "ignore",
      env: { ...process.env, ...GIT_ENV },
    });
    const repoDir = path.join(workDir, "repo");
    fs.writeFileSync(path.join(repoDir, filename), content);
    execSync("git add . && git commit -m 'test commit'", {
      cwd: repoDir,
      stdio: "ignore",
      env: { ...process.env, ...GIT_ENV },
    });
    execSync("git push", {
      cwd: repoDir,
      stdio: "ignore",
      env: { ...process.env, ...GIT_ENV },
    });
    return execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

describe("ensureRemoteUrl (integration)", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-int-ensure-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    STAGING = path.join(tempDir, `staging-${Date.now()}`);
    execSync(`git init "${STAGING}"`, { stdio: "ignore" });
    execSync(`git -C "${STAGING}" remote add origin /tmp/original-remote.git`, {
      stdio: "ignore",
    });
  });

  it("does nothing when URL already matches", async () => {
    const git = simpleGit(STAGING);
    const urlBefore = (await git.remote(["get-url", "origin"]))?.trim();

    await ensureRemoteUrl("/tmp/original-remote.git");

    const urlAfter = (await git.remote(["get-url", "origin"]))?.trim();
    expect(urlAfter).toBe(urlBefore);
  });

  it("updates remote URL when it differs", async () => {
    await ensureRemoteUrl("/tmp/new-remote.git");

    const git = simpleGit(STAGING);
    const url = (await git.remote(["get-url", "origin"]))?.trim();
    expect(url).toBe("/tmp/new-remote.git");
  });
});

describe("gitPull — clone path (integration)", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-int-clone-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    STAGING = path.join(tempDir, `staging-${Date.now()}`);
  });

  it("clones an empty bare repo", async () => {
    const remote = path.join(tempDir, "empty.git");
    createBareRepo(remote);

    await gitPull(remote);

    expect(fs.existsSync(path.join(STAGING, ".git"))).toBe(true);
    const git = simpleGit(STAGING);
    const url = (await git.remote(["get-url", "origin"]))?.trim();
    expect(url).toBe(remote);
  });

  it("clones a non-empty bare repo and checks out files", async () => {
    const remote = path.join(tempDir, "nonempty.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "hello.txt", "world\n");

    await gitPull(remote);

    expect(fs.readFileSync(path.join(STAGING, "hello.txt"), "utf-8")).toBe("world\n");
  });

  it("throws a friendly error for a non-existent repo", async () => {
    const fakePath = path.join(tempDir, "does-not-exist.git");

    await expect(gitPull(fakePath)).rejects.toThrow(
      `Repository "${fakePath}" not found. Check the URL and that you have access.`,
    );
  });
});

describe("gitPull — fetch path (integration)", () => {
  let tempDir: string;
  let remote: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-int-fetch-"));
    remote = path.join(tempDir, "remote.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "initial.txt", "v1\n");
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    STAGING = path.join(tempDir, `staging-${Date.now()}`);
  });

  it("fetches new commits from the remote", async () => {
    await gitPull(remote);
    expect(fs.readFileSync(path.join(STAGING, "initial.txt"), "utf-8")).toBe("v1\n");

    addCommitToRemote(remote, "second.txt", "v2\n");
    await gitPull(remote);

    expect(fs.readFileSync(path.join(STAGING, "second.txt"), "utf-8")).toBe("v2\n");
  });

  it("resets to a specific earlier commit", async () => {
    const remote2 = path.join(tempDir, "multi-commit.git");
    createBareRepo(remote2);
    const sha1 = addCommitToRemote(remote2, "file1.txt", "first\n");
    addCommitToRemote(remote2, "file2.txt", "second\n");

    STAGING = path.join(tempDir, `staging-specific-${Date.now()}`);
    await gitPull(remote2, sha1);

    expect(fs.existsSync(path.join(STAGING, "file1.txt"))).toBe(true);
    expect(fs.existsSync(path.join(STAGING, "file2.txt"))).toBe(false);
  });

  it("corrects a stale remote URL before fetching", async () => {
    const remoteA = path.join(tempDir, "repo-a.git");
    const remoteB = path.join(tempDir, "repo-b.git");
    createBareRepo(remoteA);
    createBareRepo(remoteB);
    addCommitToRemote(remoteA, "from-a.txt", "A\n");
    addCommitToRemote(remoteB, "from-b.txt", "B\n");

    STAGING = path.join(tempDir, `staging-stale-${Date.now()}`);
    await gitPull(remoteA);
    expect(fs.existsSync(path.join(STAGING, "from-a.txt"))).toBe(true);

    await gitPull(remoteB);
    expect(fs.readFileSync(path.join(STAGING, "from-b.txt"), "utf-8")).toBe("B\n");
    expect(fs.existsSync(path.join(STAGING, "from-a.txt"))).toBe(false);
  });

  it("throws a friendly error when fetching from a non-existent remote", async () => {
    STAGING = path.join(tempDir, `staging-fetcherr-${Date.now()}`);
    await gitPull(remote);

    const fakePath = path.join(tempDir, "gone.git");
    await expect(gitPull(fakePath)).rejects.toThrow(
      `Repository "${fakePath}" not found. Check the URL and that you have access.`,
    );
  });
});

describe("friendlyGitError patterns (integration)", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-int-errors-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    STAGING = path.join(tempDir, `staging-${Date.now()}`);
  });

  // Pattern: "does not exist" (clone a path that doesn't exist at all)
  it("translates 'does not exist' on clone", async () => {
    const fakePath = path.join(tempDir, "no-such-dir.git");
    await expect(gitPull(fakePath)).rejects.toThrow(
      `Repository "${fakePath}" not found. Check the URL and that you have access.`,
    );
  });

  // Pattern: "does not appear to be a git repository" (fetch from a dir that exists but isn't git)
  it("translates 'does not appear to be a git repository' on fetch", async () => {
    const remote = path.join(tempDir, "real-remote.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "seed.txt", "x\n");
    await gitPull(remote);

    const notGitDir = path.join(tempDir, "plain-dir");
    fs.mkdirSync(notGitDir, { recursive: true });

    await expect(gitPull(notGitDir)).rejects.toThrow(
      `Repository "${notGitDir}" not found. Check the URL and that you have access.`,
    );
  });

  // Pattern: "could not resolve host"
  it("translates 'could not resolve host'", async () => {
    const badUrl = "https://this-host-does-not-exist.invalid/repo.git";
    await expect(gitPull(badUrl)).rejects.toThrow(
      "Could not connect to remote host. Check your internet connection.",
    );
  });

  // Pattern: "connection refused"
  it("translates 'connection refused'", async () => {
    const badUrl = "git://127.0.0.1:39517/repo.git";
    await expect(gitPull(badUrl)).rejects.toThrow(
      "Could not connect to remote host. Check your internet connection.",
    );
  });

  // Patterns NOT tested here (require real authenticated remotes or long timeouts):
  // - "not found" (GitHub-specific: "remote: Repository not found.")
  // - "authentication failed" (needs remote with bad credentials)
  // - "could not read username" (needs remote with terminal prompts disabled)
  // - "connection timed out" (takes 60+ seconds to trigger)
});

describe("gitLog (integration)", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-int-log-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns commit entries matching the remote", async () => {
    const remote = path.join(tempDir, "log-repo.git");
    createBareRepo(remote);
    const sha1 = addCommitToRemote(remote, "a.txt", "1\n");
    const sha2 = addCommitToRemote(remote, "b.txt", "2\n");

    STAGING = path.join(tempDir, `staging-log-${Date.now()}`);
    await gitPull(remote);

    const entries = await gitLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].hash).toBe(sha2);
    expect(entries[1].hash).toBe(sha1);
    expect(entries[0].message).toBe("test commit");
  });

  it("respects the limit parameter", async () => {
    const remote = path.join(tempDir, "log-limit.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "a.txt", "1\n");
    addCommitToRemote(remote, "b.txt", "2\n");
    addCommitToRemote(remote, "c.txt", "3\n");

    STAGING = path.join(tempDir, `staging-loglim-${Date.now()}`);
    await gitPull(remote);

    const entries = await gitLog(2);
    expect(entries).toHaveLength(2);
  });
});

describe("gitCommitAndPush (integration)", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-int-push-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when staging is clean", async () => {
    const remote = path.join(tempDir, "clean-remote.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "seed.txt", "seed\n");

    STAGING = path.join(tempDir, `staging-clean-${Date.now()}`);
    await gitPull(remote);

    const result = await gitCommitAndPush();
    expect(result).toBeNull();
  });

  it("commits and pushes new files to the remote", async () => {
    const remote = path.join(tempDir, "push-remote.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "seed.txt", "seed\n");

    STAGING = path.join(tempDir, `staging-push-${Date.now()}`);
    await gitPull(remote);

    fs.writeFileSync(path.join(STAGING, "new-file.txt"), "hello\n");
    const result = await gitCommitAndPush();
    expect(result).not.toBeNull();

    const verifyDir = path.join(tempDir, `verify-${Date.now()}`);
    execSync(`git clone "${remote}" "${verifyDir}"`, { stdio: "ignore" });
    expect(fs.readFileSync(path.join(verifyDir, "new-file.txt"), "utf-8")).toBe("hello\n");
    fs.rmSync(verifyDir, { recursive: true, force: true });
  });

  it("generates a commit message that reflects the changes", async () => {
    const remote = path.join(tempDir, "msg-remote.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "seed.txt", "seed\n");

    STAGING = path.join(tempDir, `staging-msg-${Date.now()}`);
    await gitPull(remote);

    fs.writeFileSync(path.join(STAGING, "added.txt"), "new\n");
    await gitCommitAndPush();

    const git = simpleGit(STAGING);
    const log = await git.log({ maxCount: 1 });
    expect(log.latest!.message).toBe("added: added.txt");
  });

  it("throws a friendly error when pushing to a non-existent remote", async () => {
    const remote = path.join(tempDir, "err-remote.git");
    createBareRepo(remote);
    addCommitToRemote(remote, "seed.txt", "seed\n");

    STAGING = path.join(tempDir, `staging-pusherr-${Date.now()}`);
    await gitPull(remote);

    const git = simpleGit(STAGING);
    const fakePath = path.join(tempDir, "gone-remote.git");
    await git.remote(["set-url", "origin", fakePath]);

    fs.writeFileSync(path.join(STAGING, "will-fail.txt"), "x\n");

    await expect(gitCommitAndPush()).rejects.toThrow(
      `Repository "${fakePath}" not found. Check the URL and that you have access.`,
    );
  });
});

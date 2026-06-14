import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { toHttpsUrl, checkRepoVisibility } from "./repoVisibility.js";

describe("toHttpsUrl", () => {
  it("converts GitHub SSH URL", () => {
    expect(toHttpsUrl("git@github.com:user/repo.git")).toBe("https://github.com/user/repo.git");
  });

  it("converts GitLab SSH URL", () => {
    expect(toHttpsUrl("git@gitlab.com:org/project.git")).toBe("https://gitlab.com/org/project.git");
  });

  it("converts Bitbucket SSH URL", () => {
    expect(toHttpsUrl("git@bitbucket.org:team/repo.git")).toBe(
      "https://bitbucket.org/team/repo.git",
    );
  });

  it("converts GitHub HTTPS URL (already HTTPS)", () => {
    expect(toHttpsUrl("https://github.com/user/repo.git")).toBe("https://github.com/user/repo.git");
  });

  it("appends .git if missing", () => {
    expect(toHttpsUrl("git@github.com:user/repo")).toBe("https://github.com/user/repo.git");
  });

  it("converts ssh:// protocol URLs", () => {
    expect(toHttpsUrl("ssh://git@gitlab.com/org/project.git")).toBe(
      "https://gitlab.com/org/project.git",
    );
  });

  it("strips embedded credentials from HTTPS URLs", () => {
    expect(toHttpsUrl("https://user:pass@github.com/user/repo.git")).toBe(
      "https://github.com/user/repo.git",
    );
  });

  it("returns null for unknown hosts", () => {
    expect(toHttpsUrl("git@selfhosted.example.com:user/repo.git")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(toHttpsUrl("not-a-url")).toBeNull();
  });
});

describe("checkRepoVisibility", () => {
  const mockedExecFile = vi.mocked(execFile);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns "public" when anonymous ls-remote succeeds', async () => {
    mockedExecFile.mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(null, "", "");
        return { stdin: { end() {} } } as ReturnType<typeof execFile>;
      },
    );

    const result = await checkRepoVisibility("git@github.com:user/repo.git");
    expect(result).toBe("public");

    expect(mockedExecFile).toHaveBeenCalledWith(
      "git",
      ["-c", "credential.helper=", "ls-remote", "--quiet", "https://github.com/user/repo.git"],
      expect.objectContaining({
        timeout: 10_000,
        env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" }),
      }),
      expect.any(Function),
    );
  });

  // Real message captured from `git ls-remote` against a private/missing repo on
  // github.com, gitlab.com and bitbucket.org (HTTP 401, prompts disabled).
  it('returns "private" when the server requires auth ("terminal prompts disabled")', async () => {
    mockedExecFile.mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(
          new Error(
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
          ),
          "",
          "",
        );
        return { stdin: { end() {} } } as ReturnType<typeof execFile>;
      },
    );

    const result = await checkRepoVisibility("git@github.com:user/private-repo.git");
    expect(result).toBe("private");
  });

  // A transient server error is NOT an auth rejection and must not be assumed private.
  it('returns "unverifiable" for a transient server error', async () => {
    mockedExecFile.mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(
          new Error(
            "fatal: remote error: GitLab is currently unable to handle this request due to load (ID abc123).",
          ),
          "",
          "",
        );
        return { stdin: { end() {} } } as ReturnType<typeof execFile>;
      },
    );

    const result = await checkRepoVisibility("git@gitlab.com:org/repo.git");
    expect(result).toBe("unverifiable");
  });

  it('returns "unverifiable" (not "private") when the probe fails for a network reason', async () => {
    mockedExecFile.mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(
          new Error(
            "fatal: unable to access 'https://github.com/user/repo.git/': Could not resolve host: github.com",
          ),
          "",
          "",
        );
        return { stdin: { end() {} } } as ReturnType<typeof execFile>;
      },
    );

    const result = await checkRepoVisibility("git@github.com:user/repo.git");
    expect(result).toBe("unverifiable");
  });

  it('returns "unverifiable" when the probe times out (killed)', async () => {
    mockedExecFile.mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(Object.assign(new Error("Command failed"), { killed: true }), "", "");
        return { stdin: { end() {} } } as ReturnType<typeof execFile>;
      },
    );

    const result = await checkRepoVisibility("git@github.com:user/repo.git");
    expect(result).toBe("unverifiable");
  });

  it('returns "unknown" for unrecognized hosts', async () => {
    const result = await checkRepoVisibility("git@selfhosted.example.com:user/repo.git");
    expect(result).toBe("unknown");
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("strips GIT_ASKPASS and SSH_ASKPASS from the child process env", async () => {
    const savedAskpass = process.env.GIT_ASKPASS;
    const savedSshAskpass = process.env.SSH_ASKPASS;
    process.env.GIT_ASKPASS = "/fake/ide/askpass.sh";
    process.env.SSH_ASKPASS = "/fake/ide/ssh-askpass.sh";

    try {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
          cb(null, "", "");
          return { stdin: { end() {} } } as ReturnType<typeof execFile>;
        },
      );

      await checkRepoVisibility("git@github.com:user/repo.git");

      const opts = mockedExecFile.mock.calls[0][2] as { env: Record<string, unknown> };
      expect(opts.env.GIT_ASKPASS).toBeUndefined();
      expect(opts.env.SSH_ASKPASS).toBeUndefined();
    } finally {
      if (savedAskpass === undefined) {
        delete process.env.GIT_ASKPASS;
      } else {
        process.env.GIT_ASKPASS = savedAskpass;
      }
      if (savedSshAskpass === undefined) {
        delete process.env.SSH_ASKPASS;
      } else {
        process.env.SSH_ASKPASS = savedSshAskpass;
      }
    }
  });
});

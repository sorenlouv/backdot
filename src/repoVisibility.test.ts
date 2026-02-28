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

  it('returns "private" when anonymous ls-remote fails', async () => {
    mockedExecFile.mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(new Error("fatal: Authentication failed"), "", "");
        return { stdin: { end() {} } } as ReturnType<typeof execFile>;
      },
    );

    const result = await checkRepoVisibility("git@github.com:user/private-repo.git");
    expect(result).toBe("private");
  });

  it('returns "unknown" for unrecognized hosts', async () => {
    const result = await checkRepoVisibility("git@selfhosted.example.com:user/repo.git");
    expect(result).toBe("unknown");
    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

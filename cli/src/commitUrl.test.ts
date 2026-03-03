import { describe, it, expect } from "vitest";
import { getCommitUrl } from "./commitUrl.js";

describe("getCommitUrl", () => {
  const sha = "a1b2c3d";

  it("handles GitHub SSH URLs", () => {
    expect(getCommitUrl("git@github.com:user/repo.git", sha)).toBe(
      "https://github.com/user/repo/commit/a1b2c3d",
    );
  });

  it("handles GitHub HTTPS URLs", () => {
    expect(getCommitUrl("https://github.com/user/repo.git", sha)).toBe(
      "https://github.com/user/repo/commit/a1b2c3d",
    );
  });

  it("handles GitLab SSH URLs", () => {
    expect(getCommitUrl("git@gitlab.com:org/project.git", sha)).toBe(
      "https://gitlab.com/org/project/-/commit/a1b2c3d",
    );
  });

  it("handles Bitbucket HTTPS URLs", () => {
    expect(getCommitUrl("https://bitbucket.org/team/repo.git", sha)).toBe(
      "https://bitbucket.org/team/repo/commits/a1b2c3d",
    );
  });

  it("handles URLs without .git suffix", () => {
    expect(getCommitUrl("git@github.com:user/repo", sha)).toBe(
      "https://github.com/user/repo/commit/a1b2c3d",
    );
  });

  it("handles ssh:// protocol URLs", () => {
    expect(getCommitUrl("ssh://git@gitlab.com/org/project.git", sha)).toBe(
      "https://gitlab.com/org/project/-/commit/a1b2c3d",
    );
  });

  it("returns null for unknown hosts", () => {
    expect(getCommitUrl("git@selfhosted.example.com:user/repo.git", sha)).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(getCommitUrl("not-a-url", sha)).toBeNull();
  });
});

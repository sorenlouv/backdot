import { describe, it, expect } from "vitest";
import { extractRepoPath } from "./utils.js";

describe("extractRepoPath", () => {
  it("extracts from GitHub SSH URL", () => {
    expect(extractRepoPath("git@github.com:user/repo.git")).toEqual({
      host: "github.com",
      repoPath: "user/repo",
    });
  });

  it("extracts from GitHub HTTPS URL", () => {
    expect(extractRepoPath("https://github.com/user/repo.git")).toEqual({
      host: "github.com",
      repoPath: "user/repo",
    });
  });

  it("extracts from GitLab SSH URL", () => {
    expect(extractRepoPath("git@gitlab.com:org/project.git")).toEqual({
      host: "gitlab.com",
      repoPath: "org/project",
    });
  });

  it("extracts from Bitbucket HTTPS URL", () => {
    expect(extractRepoPath("https://bitbucket.org/team/repo")).toEqual({
      host: "bitbucket.org",
      repoPath: "team/repo",
    });
  });

  it("strips .git suffix", () => {
    const result = extractRepoPath("git@github.com:user/repo.git");
    expect(result?.repoPath).toBe("user/repo");
  });

  it("handles URLs without .git suffix", () => {
    const result = extractRepoPath("git@github.com:user/repo");
    expect(result?.repoPath).toBe("user/repo");
  });

  it("handles ssh:// protocol URLs", () => {
    expect(extractRepoPath("ssh://git@gitlab.com/org/project.git")).toEqual({
      host: "gitlab.com",
      repoPath: "org/project",
    });
  });

  it("returns null for unknown hosts", () => {
    expect(extractRepoPath("git@selfhosted.example.com:user/repo.git")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(extractRepoPath("not-a-url")).toBeNull();
  });
});

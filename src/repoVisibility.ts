import { execFile } from "node:child_process";

export type RepoVisibility = "public" | "private" | "unknown";

const KNOWN_HOSTS = ["github.com", "gitlab.com", "bitbucket.org"];

/**
 * Converts an SSH or HTTPS repo URL to a credential-free HTTPS URL
 * for known hosts. Returns `null` for unrecognized hosts.
 *
 * Examples:
 *   git@github.com:user/repo.git  → https://github.com/user/repo.git
 *   https://github.com/user/repo  → https://github.com/user/repo.git
 */
export function toHttpsUrl(repository: string): string | null {
  for (const host of KNOWN_HOSTS) {
    const idx = repository.indexOf(host);
    if (idx === -1) {continue;}

    let repoPath = repository.slice(idx + host.length + 1).trim();
    if (!repoPath.endsWith(".git")) {
      repoPath += ".git";
    }

    return `https://${host}/${repoPath}`;
  }
  return null;
}

/**
 * Checks whether `repository` is publicly readable by attempting an
 * anonymous `git ls-remote` over HTTPS with all credential helpers disabled.
 */
export async function checkRepoVisibility(repository: string): Promise<RepoVisibility> {
  const httpsUrl = toHttpsUrl(repository);
  if (!httpsUrl) {return "unknown";}

  try {
    await execGitLsRemote(httpsUrl);
    return "public";
  } catch {
    return "private";
  }
}

function execGitLsRemote(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-c", "credential.helper=", "ls-remote", "--quiet", url],
      {
        timeout: 10_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error) => {
        if (error) {reject(error);}
        else {resolve();}
      },
    );

    // Don't let stdin keep the process alive
    child.stdin?.end();
  });
}

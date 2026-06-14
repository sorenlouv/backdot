import { execFile } from "node:child_process";
import { extractRepoPath } from "./utils.js";

export type RepoVisibility = "public" | "private" | "unknown" | "unverifiable";

/**
 * Converts an SSH or HTTPS repo URL to a credential-free HTTPS URL
 * for known hosts. Returns `null` for unrecognized hosts.
 *
 * Examples:
 *   git@github.com:user/repo.git  → https://github.com/user/repo.git
 *   https://github.com/user/repo  → https://github.com/user/repo.git
 */
export function toHttpsUrl(repository: string): string | null {
  const parsed = extractRepoPath(repository);
  if (!parsed) {
    return null;
  }
  return `https://${parsed.host}/${parsed.repoPath}.git`;
}

/**
 * Checks whether `repository` is publicly readable by attempting an
 * anonymous `git ls-remote` over HTTPS with all credential helpers disabled.
 */
export async function checkRepoVisibility(repository: string): Promise<RepoVisibility> {
  const httpsUrl = toHttpsUrl(repository);
  if (!httpsUrl) {
    return "unknown";
  }

  try {
    await execGitLsRemote(httpsUrl);
    return "public";
  } catch (error) {
    return indicatesRepoIsPrivate(error) ? "private" : "unverifiable";
  }
}

/**
 * Distinguishes a repo that positively rejects anonymous reads (authentication
 * required, access denied, or hidden as a 404) from a probe that never reached a
 * verdict (DNS failure, timeout, proxy/TLS error, killed process). Only the
 * former proves the repo is private. A failed probe must NOT be treated as
 * private — otherwise a transient network error would silently allow a backup to
 * a repository that might actually be public.
 */
function indicatesRepoIsPrivate(error: unknown): boolean {
  const { message, stderr } = error as { message?: string; stderr?: string | Buffer };
  const combinedOutput = `${message ?? ""} ${stderr ?? ""}`.toLowerCase();
  const anonymousAccessRejectedSignals = [
    "authentication failed",
    "could not read username",
    "could not read password",
    "invalid username or password",
    "access denied",
    "permission denied",
    "terminal prompts disabled",
    "not found",
    "403",
    "401",
  ];
  return anonymousAccessRejectedSignals.some((signal) => combinedOutput.includes(signal));
}

function execGitLsRemote(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-c", "credential.helper=", "ls-remote", "--quiet", url],
      {
        timeout: 10_000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: undefined,
          SSH_ASKPASS: undefined,
        },
      },
      (error, _stdout, stderr) => {
        if (error) {
          // git writes the real cause (auth vs. network) to stderr; carry it so
          // the caller can tell "definitely private" from "could not verify".
          reject(Object.assign(error, { stderr }));
        } else {
          resolve();
        }
      },
    );

    // Don't let stdin keep the process alive
    child.stdin?.end();
  });
}

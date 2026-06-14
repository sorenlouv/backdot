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
    return rejectedAnonymousAccess(error) ? "private" : "unverifiable";
  }
}

/**
 * Classifies a failed anonymous `git ls-remote`. Based on the real return values
 * captured (2026-06) against github.com, gitlab.com and bitbucket.org with
 * credential helpers and prompts disabled (GIT_TERMINAL_PROMPT=0):
 *
 *   - A repo that requires authentication answers with HTTP 401; git then cannot
 *     read a credential without a prompt and exits 128 with:
 *       fatal: could not read Username for '<host>': terminal prompts disabled
 *     This is the one response that proves the repo is not anonymously readable,
 *     so we treat it as private. (Bitbucket returns this even for public repos,
 *     so a public Bitbucket repo is treated as private too — it is not readable
 *     over anonymous git either way.)
 *
 *   - Every other failure — DNS error ("Could not resolve host"), a timeout that
 *     kills the process, a transient 5xx ("unable to handle this request") —
 *     leaves visibility undetermined and must NOT be assumed private.
 *
 * The child runs with LC_ALL=C so git's message stays English; "terminal prompts
 * disabled" appears only because we disabled prompts and the server demanded
 * credentials.
 */
function rejectedAnonymousAccess(error: unknown): boolean {
  const { message, stderr } = error as { message?: string; stderr?: string | Buffer };
  return `${message ?? ""} ${stderr ?? ""}`.includes("terminal prompts disabled");
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
          LC_ALL: "C", // keep git's error messages English so classification is locale-stable
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

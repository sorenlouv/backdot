import fs from "node:fs";
import { TOKEN_FILE_PATH } from "./paths.js";

// Defaults to the public API. The override is a TEST-ONLY seam (honored only
// under NODE_ENV=test) so it can never redirect the public-repo safety check
// away from real GitHub in production.
function githubApiBase(): string {
  if (process.env.NODE_ENV === "test" && process.env.BACKDOT_GITHUB_API) {
    return process.env.BACKDOT_GITHUB_API;
  }
  return "https://api.github.com";
}

export interface GitHubRepo {
  owner: string;
  repo: string;
}

// backdot is GitHub-only and HTTPS-only. Accept exactly
// https://github.com/<owner>/<repo>[.git][/] and reject everything else
// (SSH/git@, ssh://, other hosts, embedded credentials, extra path segments).
// The owner/repo character classes are restricted to GitHub's allowed set, so
// URL-significant characters (?, #, @, :, /) can't smuggle a query/fragment into
// the captured repo name and make the API check target a different repository.
const REPO_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i;

export function parseGitHubRepoUrl(url: string): GitHubRepo | null {
  const match = url.match(REPO_URL_RE);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export function isGitHubRepoUrl(url: string): boolean {
  return parseGitHubRepoUrl(url) !== null;
}

export function commitUrl(remoteUrl: string, sha: string): string | null {
  const parsed = parseGitHubRepoUrl(remoteUrl);
  if (!parsed) {
    return null;
  }
  return `https://github.com/${parsed.owner}/${parsed.repo}/commit/${sha}`;
}

/**
 * git config flags (`git -c <entry>`) that authenticate HTTPS requests to
 * github.com with the PAT, via an `http.<url>.extraHeader` Basic credential.
 * This keeps the token OUT of the remote URL — so it never lands in
 * .git/config, `git remote get-url`, logs, the README, or the commit URL.
 */
export function gitAuthConfig(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return [`http.https://github.com/.extraHeader=AUTHORIZATION: basic ${basic}`];
}

export interface RepoAccess {
  isPrivate: boolean;
}

/**
 * Verifies the token and repo access in a single GitHub REST call and returns
 * whether the repo is private. A 200 proves the token is valid AND has access;
 * the `private` boolean drives the "refuse backup to a public repo" safety
 * feature. Every non-200 outcome throws — callers fail closed.
 */
export async function fetchRepoAccess(
  { owner, repo }: GitHubRepo,
  token: string,
): Promise<RepoAccess> {
  let res: Response;
  try {
    res = await fetch(`${githubApiBase()}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "backdot",
      },
    });
  } catch {
    throw new Error(
      `Could not reach GitHub to verify "${owner}/${repo}". Check your internet connection.`,
    );
  }

  if (res.status === 401) {
    throw new Error(
      "GitHub token is invalid or expired.\n" +
        `  Update it in ${TOKEN_FILE_PATH} (or set BACKDOT_GITHUB_TOKEN).\n` +
        "  Create a fine-grained token at https://github.com/settings/personal-access-tokens",
    );
  }
  if (res.status === 403) {
    throw new Error(
      `GitHub denied access to "${owner}/${repo}" (403).\n` +
        "  The token may lack permission, need SSO authorization, or you've hit a rate limit.",
    );
  }
  if (res.status === 404) {
    throw new Error(
      `Repository "${owner}/${repo}" not found, or your token can't access it.\n` +
        "  Check the repository URL, and that the token has access to this repo (Contents: read and write).",
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}) for "${owner}/${repo}".`);
  }

  let data: { private?: boolean };
  try {
    data = (await res.json()) as { private?: boolean };
  } catch {
    throw new Error(`GitHub returned an unexpected (non-JSON) response for "${owner}/${repo}".`);
  }
  // Fail closed: treat anything other than an explicit `private: true` as
  // public, so an unexpected response can never green-light a public push.
  return { isPrivate: data.private === true };
}

/** Reads the PAT from the 0600 token file, refusing if it is group/other-readable. */
export function readTokenFile(): string | null {
  if (!fs.existsSync(TOKEN_FILE_PATH)) {
    return null;
  }
  if (process.platform !== "win32") {
    const mode = fs.statSync(TOKEN_FILE_PATH).mode & 0o777;
    const isAccessibleByGroupOrOthers = (mode & 0o077) !== 0;
    if (isAccessibleByGroupOrOthers) {
      throw new Error(
        `Token file ${TOKEN_FILE_PATH} has overly permissive permissions (${mode.toString(8)}).\n` +
          `  Run: chmod 600 ${TOKEN_FILE_PATH}`,
      );
    }
  }
  return fs.readFileSync(TOKEN_FILE_PATH, "utf-8").trim();
}

/** Resolves the PAT from the env override, then the token file. Throws if neither is set. */
export function resolveGitHubToken(): string {
  const token = process.env.BACKDOT_GITHUB_TOKEN?.trim() || readTokenFile();
  if (!token) {
    throw new Error(
      "No GitHub token found.\n" +
        "  Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens\n" +
        `  and save it to ${TOKEN_FILE_PATH} (chmod 600), or set BACKDOT_GITHUB_TOKEN.`,
    );
  }
  return token;
}

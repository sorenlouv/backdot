import { extractRepoPath } from "./utils.js";

const PROVIDERS: Record<string, (repoPath: string, sha: string) => string> = {
  "github.com": (repoPath, sha) => `https://github.com/${repoPath}/commit/${sha}`,
  "gitlab.com": (repoPath, sha) => `https://gitlab.com/${repoPath}/-/commit/${sha}`,
  "bitbucket.org": (repoPath, sha) => `https://bitbucket.org/${repoPath}/commits/${sha}`,
};

export function getCommitUrl(remoteUrl: string, sha: string): string | null {
  const parsed = extractRepoPath(remoteUrl);
  if (!parsed) {
    return null;
  }
  const buildUrl = PROVIDERS[parsed.host];
  if (!buildUrl) {
    return null;
  }
  return buildUrl(parsed.repoPath, sha);
}

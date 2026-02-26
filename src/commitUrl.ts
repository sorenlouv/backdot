const PROVIDERS: Record<string, (repoPath: string, sha: string) => string> = {
  "github.com": (p, sha) => `https://github.com/${p}/commit/${sha}`,
  "gitlab.com": (p, sha) => `https://gitlab.com/${p}/-/commit/${sha}`,
  "bitbucket.org": (p, sha) => `https://bitbucket.org/${p}/commits/${sha}`,
};

export function getCommitUrl(remoteUrl: string, sha: string): string | null {
  for (const [host, buildUrl] of Object.entries(PROVIDERS)) {
    const idx = remoteUrl.indexOf(host);
    if (idx === -1) continue;

    let repoPath = remoteUrl.slice(idx + host.length + 1).trim();
    if (repoPath.endsWith(".git")) {
      repoPath = repoPath.slice(0, -4);
    }

    return buildUrl(repoPath, sha);
  }
  return null;
}

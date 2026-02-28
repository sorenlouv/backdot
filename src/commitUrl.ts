const PROVIDERS: Record<string, (repoPath: string, sha: string) => string> = {
  "github.com": (repoPath, sha) => `https://github.com/${repoPath}/commit/${sha}`,
  "gitlab.com": (repoPath, sha) => `https://gitlab.com/${repoPath}/-/commit/${sha}`,
  "bitbucket.org": (repoPath, sha) => `https://bitbucket.org/${repoPath}/commits/${sha}`,
};

export function getCommitUrl(remoteUrl: string, sha: string): string | null {
  for (const [host, buildUrl] of Object.entries(PROVIDERS)) {
    const idx = remoteUrl.indexOf(host);
    if (idx === -1) {
      continue;
    }

    const separatorLength = 1; // skip the ":" (SSH) or "/" (HTTPS) after the hostname
    let repoPath = remoteUrl.slice(idx + host.length + separatorLength).trim();
    if (repoPath.endsWith(".git")) {
      repoPath = repoPath.slice(0, -4);
    }

    return buildUrl(repoPath, sha);
  }
  return null;
}

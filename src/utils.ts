export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const KNOWN_HOSTS = ["github.com", "gitlab.com", "bitbucket.org"];

/**
 * Extracts the repo path (e.g. "user/repo") from an SSH or HTTPS URL
 * for known hosts. Returns `null` for unrecognized hosts.
 */
export function extractRepoPath(url: string): { host: string; repoPath: string } | null {
  for (const host of KNOWN_HOSTS) {
    const idx = url.indexOf(host);
    if (idx === -1) {
      continue;
    }
    const separatorLength = 1; // skip ":" (SSH) or "/" (HTTPS) after hostname
    let repoPath = url.slice(idx + host.length + separatorLength).trim();
    if (repoPath.endsWith(".git")) {
      repoPath = repoPath.slice(0, -4);
    }
    return { host, repoPath };
  }
  return null;
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count !== 1 ? "s" : ""}`;
}

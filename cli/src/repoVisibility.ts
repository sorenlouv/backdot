import https from "node:https";
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

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Determines whether `repository` is publicly readable by sending an anonymous
 * (no-credentials) request to git's smart-HTTP advertised-refs endpoint and
 * classifying the HTTP status code — a documented, stable signal:
 *
 *   - 200          → refs are served anonymously                    → "public"
 *   - 401/403/404  → host refuses anonymous reads (private, or
 *                    hidden-as-missing)                              → "private"
 *   - anything else (3xx, 5xx, …) or no response at all (DNS error,
 *                    timeout, TLS/proxy failure)                     → "unverifiable"
 *
 * Verified 2026-06: github.com & gitlab.com public → 200, private → 401;
 * bitbucket.org returns 401 even for public repos, so a public Bitbucket repo
 * reads as private here — it is not anonymously readable over git either way.
 * The status code does not depend on the request's User-Agent.
 *
 * Unknown hosts have no HTTPS form to probe and return "unknown".
 */
export async function checkRepoVisibility(repository: string): Promise<RepoVisibility> {
  const httpsUrl = toHttpsUrl(repository);
  if (!httpsUrl) {
    return "unknown";
  }

  let status: number;
  try {
    status = await probeAnonymousRefsStatus(`${httpsUrl}/info/refs?service=git-upload-pack`);
  } catch {
    // No usable response (DNS failure, timeout, TLS/proxy error): visibility is
    // undetermined — never assume private.
    return "unverifiable";
  }

  if (status === 200) {
    return "public";
  }
  if (status === 401 || status === 403 || status === 404) {
    return "private";
  }
  return "unverifiable";
}

/**
 * Issues an anonymous GET to a smart-HTTP refs URL and resolves with the HTTP
 * status code. Sends no credentials; rejects on connection failure or timeout.
 */
function probeAnonymousRefsStatus(refsUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      refsUrl,
      { headers: { "User-Agent": "backdot" }, timeout: PROBE_TIMEOUT_MS },
      (response) => {
        response.resume(); // drain the body so the socket is released
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Visibility probe timed out")));
    request.on("error", reject);
  });
}

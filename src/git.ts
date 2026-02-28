import fs from "node:fs";
import path from "node:path";
import pRetry from "p-retry";
import { simpleGit, type SimpleGit, CleanOptions } from "simple-git";
import { logger } from "./log.js";
import { STAGING_DIR, STAGING_GIT_DIR } from "./paths.js";
import { getCommitUrl } from "./commitUrl.js";
import { errorMessage, pluralize, uniq } from "./utils.js";

interface FileChangeSummary {
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: Array<{ from: string; to: string }>;
}

export function buildCommitMessage(changes: FileChangeSummary, maxLength = 250): string {
  const uniqueBasenames = (paths: string[]) =>
    uniq(paths.map((filePath) => path.basename(filePath)));

  const removed = uniqueBasenames(changes.deleted);
  const added = uniqueBasenames(changes.created);
  const modified = uniqueBasenames([...changes.modified, ...changes.renamed.map((r) => r.to)]);

  const categories = [
    { label: "removed", files: removed },
    { label: "added", files: added },
    { label: "modified", files: modified },
  ].filter((category) => category.files.length > 0);

  if (categories.length === 0) {
    return "backup";
  }

  function formatCategory(category: (typeof categories)[number], listFiles: boolean): string {
    if (listFiles) {
      return `${category.label}: ${category.files.join(", ")}`;
    }
    return `${category.label}: ${pluralize(category.files.length, "file")}`;
  }

  function joinCategories(showFileNames: boolean[]): string {
    return categories.map((category, i) => formatCategory(category, showFileNames[i])).join("; ");
  }

  // If the message exceeds maxLength, progressively replace file lists with
  // counts, starting with the least important category.
  const showFileNames = categories.map(() => true);
  let message = joinCategories(showFileNames);
  if (message.length <= maxLength) {
    return message;
  }

  for (const label of ["modified", "added", "removed"]) {
    const idx = categories.findIndex((category) => category.label === label);
    if (idx !== -1 && showFileNames[idx]) {
      showFileNames[idx] = false;
      message = joinCategories(showFileNames);
      if (message.length <= maxLength) {
        return message;
      }
    }
  }

  return message.slice(0, maxLength - 3) + "...";
}

export async function ensureRemoteUrl(repository: string): Promise<void> {
  const git = simpleGit(STAGING_DIR);
  const currentUrl = (await git.remote(["get-url", "origin"]))?.trim();
  if (currentUrl !== repository) {
    await git.remote(["set-url", "origin", repository]);
  }
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  return (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
}

export function friendlyGitError(raw: string, repository: string): string {
  const normalizedMessage = raw.toLowerCase();
  if (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("does not exist") ||
    normalizedMessage.includes("does not appear to be a git repository")
  ) {
    return `Repository "${repository}" not found. Check the URL and that you have access.`;
  }
  if (
    normalizedMessage.includes("authentication failed") ||
    normalizedMessage.includes("could not read username")
  ) {
    return `Authentication failed for "${repository}". Check your credentials or SSH key.`;
  }
  if (
    normalizedMessage.includes("could not resolve host") ||
    normalizedMessage.includes("connection refused") ||
    normalizedMessage.includes("connection timed out")
  ) {
    return "Could not connect to remote host. Check your internet connection.";
  }
  return raw;
}

export function gitError(err: unknown, repository: string): Error {
  const raw = errorMessage(err);
  return new Error(friendlyGitError(raw, repository), { cause: err });
}

export async function gitPull(repository: string, commit?: string): Promise<void> {
  try {
    if (fs.existsSync(STAGING_GIT_DIR)) {
      const git = simpleGit(STAGING_DIR);
      await ensureRemoteUrl(repository);
      await git.fetch("origin");
      const resetTarget = commit ?? `origin/${await getCurrentBranch(git)}`;
      await git.reset(["--hard", resetTarget]);
      await git.clean(CleanOptions.FORCE, ["-d"]);
    } else {
      try {
        await simpleGit().clone(repository, STAGING_DIR);
      } catch (err) {
        if (!errorMessage(err).includes("empty repository")) {
          throw err;
        }
        fs.mkdirSync(STAGING_DIR, { recursive: true });
        const git = simpleGit(STAGING_DIR);
        await git.init();
        await git.addRemote("origin", repository);
      }
      if (commit) {
        const git = simpleGit(STAGING_DIR);
        await git.reset(["--hard", commit]);
        await git.clean(CleanOptions.FORCE, ["-d"]);
      }
    }
  } catch (err) {
    throw gitError(err, repository);
  }
  logger.info("Synced staging directory from remote");
}

export async function gitLog(
  limit = 20,
): Promise<Array<{ hash: string; date: string; message: string }>> {
  const git = simpleGit(STAGING_DIR);
  const log = await git.log({ maxCount: limit });
  return log.all.map((entry) => ({
    hash: entry.hash,
    date: entry.date,
    message: entry.message,
  }));
}

export async function gitCommitAndPush(): Promise<{ commitUrl: string | null } | null> {
  const git = simpleGit(STAGING_DIR);

  await git.add(".");

  const status = await git.status();
  if (status.isClean()) {
    logger.info("No changes to commit");
    return null;
  }

  const message = buildCommitMessage(status);
  await git.commit(message);

  try {
    await pRetry(async () => git.push(["-u", "origin", "HEAD"]), {
      retries: 5,
      onFailedAttempt: async ({ attemptNumber, retriesLeft }) => {
        logger.info(
          `Push failed (attempt ${attemptNumber}, ${retriesLeft} retries left), rebasing`,
        );
        await git.fetch("origin");
        const branch = await getCurrentBranch(git);
        try {
          await git.rebase([`origin/${branch}`]);
        } catch {
          await git.rebase(["--abort"]);
          throw new Error("Rebase conflict, aborting retry");
        }
      },
    });
  } catch (err) {
    const remoteUrl = ((await git.remote(["get-url", "origin"])) ?? "").trim();
    throw gitError(err, remoteUrl);
  }

  logger.info(`Committed and pushed: ${message}`);

  const commitHash = (await git.revparse(["HEAD"])).trim();
  const remoteUrl = (await git.remote(["get-url", "origin"])) ?? "";
  const commitUrl = getCommitUrl(remoteUrl, commitHash);
  return { commitUrl };
}

import fs from "node:fs";
import path from "node:path";
import pRetry from "p-retry";
import { simpleGit, CleanOptions } from "simple-git";
import { logger } from "./log.js";
import { STAGING_DIR } from "./staging.js";
import { getCommitUrl } from "./commitUrl.js";

interface FileChangeSummary {
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: Array<{ from: string; to: string }>;
}

export function buildCommitMessage(changes: FileChangeSummary, maxLen = 250): string {
  const unique = (paths: string[]) => [...new Set(paths.map((f) => path.basename(f)))];

  const removed = unique(changes.deleted);
  const added = unique(changes.created);
  const modified = unique([...changes.modified, ...changes.renamed.map((r) => r.to)]);

  const categories = [
    { label: "removed", files: removed },
    { label: "added", files: added },
    { label: "modified", files: modified },
  ].filter((c) => c.files.length > 0);

  if (categories.length === 0) {
    return "backup";
  }

  function format(cat: (typeof categories)[number], listFiles: boolean): string {
    if (listFiles) {
      return `${cat.label}: ${cat.files.join(", ")}`;
    }
    const n = cat.files.length;
    return `${cat.label}: ${n} file${n !== 1 ? "s" : ""}`;
  }

  function build(listFlags: boolean[]): string {
    return categories.map((cat, i) => format(cat, listFlags[i])).join("; ");
  }

  const flags = categories.map(() => true);
  let msg = build(flags);
  if (msg.length <= maxLen) return msg;

  for (const label of ["modified", "added", "removed"]) {
    const idx = categories.findIndex((c) => c.label === label);
    if (idx !== -1 && flags[idx]) {
      flags[idx] = false;
      msg = build(flags);
      if (msg.length <= maxLen) return msg;
    }
  }

  return msg.slice(0, maxLen - 3) + "...";
}

export async function gitPull(repository: string, commit?: string): Promise<void> {
  if (fs.existsSync(path.join(STAGING_DIR, ".git"))) {
    const git = simpleGit(STAGING_DIR);
    await git.fetch("origin");
    const target = commit ?? `origin/${await git.revparse(["--abbrev-ref", "HEAD"])}`;
    await git.reset(["--hard", target]);
    await git.clean(CleanOptions.FORCE, ["-d"]);
  } else {
    try {
      await simpleGit().clone(repository, STAGING_DIR);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("empty")) {
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

  await pRetry(async () => git.push(["-u", "origin", "HEAD"]), {
    retries: 5,
    onFailedAttempt: async ({ attemptNumber, retriesLeft }) => {
      logger.info(`Push failed (attempt ${attemptNumber}, ${retriesLeft} retries left), rebasing`);
      await git.fetch("origin");
      const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
      try {
        await git.rebase([`origin/${branch}`]);
      } catch {
        await git.rebase(["--abort"]);
        throw new Error("Rebase conflict, aborting retry");
      }
    },
  });

  logger.info(`Committed and pushed: ${message}`);

  const sha = (await git.revparse(["HEAD"])).trim();
  const remoteUrl = (await git.remote(["get-url", "origin"])) ?? "";
  const commitUrl = getCommitUrl(remoteUrl, sha);
  return { commitUrl };
}

import fs from "node:fs";
import path from "node:path";
import pRetry from "p-retry";
import { simpleGit, CleanOptions } from "simple-git";
import { logger } from "./log.js";
import { STAGING_DIR } from "./staging.js";
import { getCommitUrl } from "./commitUrl.js";

export async function gitPull(repository: string): Promise<void> {
  if (fs.existsSync(path.join(STAGING_DIR, ".git"))) {
    const git = simpleGit(STAGING_DIR);
    await git.fetch("origin");
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    await git.reset(["--hard", `origin/${branch}`]);
    await git.clean(CleanOptions.FORCE, ["-d"]);
  } else {
    try {
      await simpleGit().clone(repository, STAGING_DIR);
    } catch {
      fs.mkdirSync(STAGING_DIR, { recursive: true });
      const git = simpleGit(STAGING_DIR);
      await git.init();
      await git.addRemote("origin", repository);
    }
  }
  logger.info("Synced staging directory from remote");
}

export async function gitCommitAndPush(): Promise<{ commitUrl: string | null } | null> {
  const git = simpleGit(STAGING_DIR);

  await git.add(".");

  const status = await git.status();
  if (status.isClean()) {
    logger.info("No changes to commit");
    return null;
  }

  const date = new Date().toISOString().split("T")[0];
  const message = `Automated backup: ${date}`;
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

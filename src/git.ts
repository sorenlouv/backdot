import fs from "node:fs";
import path from "node:path";
import { simpleGit, CleanOptions } from "simple-git";
import { logger } from "./log.js";
import { STAGING_DIR } from "./staging.js";

export async function gitPull(repository: string): Promise<void> {
  if (fs.existsSync(path.join(STAGING_DIR, ".git"))) {
    const git = simpleGit(STAGING_DIR);
    await git.fetch("origin");
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    await git.reset(["--hard", `origin/${branch}`]);
    await git.clean(CleanOptions.FORCE, ["-d"]);
  } else {
    await simpleGit().clone(repository, STAGING_DIR);
  }
  logger.info("Synced staging directory from remote");
}

export async function gitSync(repository: string): Promise<void> {
  if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
  }

  const git = simpleGit(STAGING_DIR);

  if (!fs.existsSync(path.join(STAGING_DIR, ".git"))) {
    logger.info("Initializing new git repository in staging directory");
    await git.init();
    await git.addRemote("origin", repository);
  }

  await git.add(".");

  const status = await git.status();
  if (status.isClean()) {
    logger.info("No changes to commit");
    return;
  }

  const date = new Date().toISOString().split("T")[0];
  const message = `Automated backup: ${date}`;
  await git.commit(message);
  logger.info(`Committed: ${message}`);

  try {
    await git.push(["-u", "origin", "HEAD"]);
    logger.info("Pushed to remote");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Push failed: ${msg}`);
    throw new Error(`Push failed: ${msg}`);
  }
}

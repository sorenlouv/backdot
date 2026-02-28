import ora from "ora";
import { loadConfig, CONFIG_PATH } from "../config.js";
import { resolveFiles } from "../resolveFiles.js";
import { cleanStaging, copyToStaging, writeRepoReadme } from "../staging.js";
import { gitPull, gitCommitAndPush } from "../git.js";
import { logger } from "../log.js";
import { pluralize } from "../utils.js";
import { checkRepoVisibility } from "../repoVisibility.js";

export async function backup(): Promise<void> {
  logger.info("Starting backup");
  const config = loadConfig();
  logger.info(`Repository: ${config.repository}`);
  logger.info(`Machine: ${config.machine}`);

  const spinner = ora("Checking repository visibility").start();
  try {
    const visibility = await checkRepoVisibility(config.repository);
    if (visibility === "public") {
      spinner.fail("Backup refused — repository is public");
      throw new Error(
        `Repository "${config.repository}" is publicly accessible.\n` +
          "Backing up to a public repo would expose sensitive files.\n" +
          "Make the repository private, then try again.",
      );
    }

    spinner.text = "Resolving files";
    const userFiles = resolveFiles(config);
    logger.info(`Resolved ${pluralize(userFiles.length, "file")}`);

    if (userFiles.length === 0) {
      spinner.info("No files resolved, nothing to back up");
      return;
    }

    const files = [...userFiles, CONFIG_PATH];

    spinner.text = "Syncing with remote";
    await gitPull(config.repository);

    spinner.text = `Copying ${pluralize(files.length, "file")} to staging`;
    cleanStaging(config.machine);
    copyToStaging(files, config.machine);
    writeRepoReadme(config.repository);

    spinner.text = "Pushing to remote";
    const result = await gitCommitAndPush();

    const successMsg = result?.commitUrl
      ? `Backup complete → ${result.commitUrl}`
      : "Backup complete";
    spinner.succeed(successMsg);
    console.log();
  } catch (err) {
    spinner.fail("Backup failed");
    throw err;
  }

  logger.info("Backup complete");
}

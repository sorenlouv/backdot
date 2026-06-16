import fs from "node:fs";
import os from "node:os";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, CONFIG_PATH } from "../config.js";
import { resolveFiles } from "../resolveFiles.js";
import { compareFiles } from "../staging.js";
import { isScheduled } from "../launchd.js";
import { pluralize, errorMessage } from "../utils.js";
import { parseGitHubRepoUrl, fetchRepoAccess, resolveGitHubToken } from "../github.js";
import { deriveKey } from "../crypto/encryption.js";
import { resolvePassword } from "../crypto/password.js";

function abbreviateHomePath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? "~" + filePath.slice(home.length) : filePath;
}

export async function status(): Promise<void> {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log();
    console.log(`  No config found. Run ${chalk.bold("backdot init")} to get started.\n`);
    return;
  }

  const scheduled = isScheduled();
  console.log();
  console.log(
    `  Schedule:    ${scheduled ? "active (daily at 02:00)" : `not active  (run ${chalk.bold("backdot schedule")} to enable)`}`,
  );

  const config = loadConfig();
  console.log(`  Repo:        ${config.repository}`);
  console.log(`  Machine:     ${config.machine}`);
  if (config.encrypt) {
    console.log(`  Encryption:  ${chalk.green("enabled")}`);
  }

  const token = resolveGitHubToken();
  const repo = parseGitHubRepoUrl(config.repository);
  if (!repo) {
    console.log(`  Visibility:  ${chalk.red("invalid repository URL")}`);
    return;
  }

  const visibilitySpinner = ora("Verifying GitHub access").start();
  let isPrivate: boolean;
  try {
    ({ isPrivate } = await fetchRepoAccess(repo, token));
  } catch (err) {
    visibilitySpinner.stop();
    console.log(`  Visibility:  ${chalk.yellow("could not verify")}`);
    console.log();
    console.log(chalk.yellow(`  ${errorMessage(err)}`));
    console.log();
    return;
  }
  visibilitySpinner.stop();

  if (!isPrivate) {
    console.log(`  Visibility:  ${chalk.red.bold("public (backup disabled)")}`);
    console.log();
    console.log(
      chalk.red(
        "  ⚠ Repository is public. Backup is disabled to prevent leaking sensitive files.\n" +
          "    Make the repository private, then try again.",
      ),
    );
    console.log();
    return;
  }

  const resolveKey = config.encrypt
    ? async () => deriveKey((await resolvePassword()).password)
    : undefined;

  console.log();

  const spinner = ora("Resolving files").start();
  try {
    const userFiles = resolveFiles(config);

    if (userFiles.length === 0) {
      spinner.warn("No files resolved. Check your ~/.backdot/config.json entries.");
      console.log();
      return;
    }

    const files = [...userFiles, CONFIG_PATH];

    spinner.text = "Comparing with remote backup";
    let comparison;
    try {
      comparison = await compareFiles({
        files,
        machine: config.machine,
        repository: config.repository,
        token,
        resolveKey,
      });
    } catch (err) {
      spinner.stop();
      console.log(chalk.yellow(`  Could not fetch status: ${errorMessage(err)}`));
      console.log();
      return;
    }
    spinner.stop();

    const { backedUp, modified, notBackedUp, remoteIsEmpty } = comparison;

    if (remoteIsEmpty) {
      console.log(`  No backup yet — showing what ${chalk.bold("backdot backup")} would back up.`);
      console.log();
    }

    if (modified.length === 0 && notBackedUp.length === 0) {
      console.log(chalk.green(`  All ${pluralize(files.length, "file")} are backed up ✓`));
    } else {
      if (modified.length > 0) {
        console.log(chalk.yellow(`  Modified since last backup (${modified.length}):`));
        for (const filePath of modified) {
          console.log(`        ${abbreviateHomePath(filePath)}`);
        }
        console.log();
      }

      if (notBackedUp.length > 0) {
        console.log(chalk.red(`  Not yet backed up (${notBackedUp.length}):`));
        for (const filePath of notBackedUp) {
          console.log(`        ${abbreviateHomePath(filePath)}`);
        }
        console.log();
      }

      if (backedUp.length > 0) {
        console.log(chalk.green(`  Backed up (${backedUp.length}):`));
        for (const filePath of backedUp) {
          console.log(`        ${abbreviateHomePath(filePath)}`);
        }
        console.log();
      }

      console.log(`  Run ${chalk.bold("backdot backup")} to back up all changes.`);
    }
  } catch (err) {
    spinner.fail("Status check failed");
    throw err;
  }

  console.log();
}

import os from "node:os";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, CONFIG_PATH } from "../config.js";
import { resolveFiles } from "../resolveFiles.js";
import { compareFiles } from "../staging.js";
import { isScheduled } from "../launchd.js";
import { pluralize } from "../utils.js";

function tildePath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? "~" + filePath.slice(home.length) : filePath;
}

export async function status(): Promise<void> {
  const scheduled = isScheduled();
  console.log();
  console.log(
    `  Schedule:  ${scheduled ? "active (daily at 02:00)" : `not active  (run ${chalk.bold("backdot schedule")} to enable)`}`,
  );

  const config = loadConfig();
  console.log(`  Repo:      ${config.repository}`);
  console.log(`  Machine:   ${config.machine}`);
  console.log();

  const spinner = ora("Resolving files").start();
  try {
    const userFiles = resolveFiles(config);

    if (userFiles.length === 0) {
      spinner.warn("No files resolved. Check your ~/.backdot.json entries.");
      console.log();
      return;
    }

    const files = [...userFiles, CONFIG_PATH];

    spinner.text = "Comparing with remote backup";
    const { backedUp, modified, notBackedUp, error } = await compareFiles(
      files,
      config.machine,
      config.repository,
    );
    spinner.stop();

    if (error) {
      console.log(chalk.yellow(`  Could not fetch status: ${error}`));
      return;
    }

    if (modified.length === 0 && notBackedUp.length === 0) {
      console.log(chalk.green(`  All ${pluralize(files.length, "file")} are backed up ✓`));
    } else {
      if (modified.length > 0) {
        console.log(chalk.yellow(`  Modified since last backup (${modified.length}):`));
        for (const f of modified) {
          console.log(`        ${tildePath(f)}`);
        }
        console.log();
      }

      if (notBackedUp.length > 0) {
        console.log(chalk.red(`  Not yet backed up (${notBackedUp.length}):`));
        for (const f of notBackedUp) {
          console.log(`        ${tildePath(f)}`);
        }
        console.log();
      }

      if (backedUp.length > 0) {
        console.log(chalk.green(`  Backed up (${backedUp.length}):`));
        for (const f of backedUp) {
          console.log(`        ${tildePath(f)}`);
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

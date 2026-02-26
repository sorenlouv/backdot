#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, CONFIG_PATH } from "./config.js";
import { resolveFiles } from "./resolve.js";
import { cleanStaging, copyToStaging, writeRepoReadme, compareFiles } from "./staging.js";
import { gitPull, gitCommitAndPush } from "./git.js";
import { restore } from "./restore.js";
import { init } from "./init.js";
import { setupLaunchd, uninstallLaunchd, isScheduled } from "./plist.js";
import { logger } from "./log.js";

function getVersion(): string {
  const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function backup(): Promise<void> {
  logger.info("Starting backup");
  const config = loadConfig();
  logger.info(`Repository: ${config.repository}`);
  logger.info(`Machine: ${config.machine}`);

  const spinner = ora("Resolving files").start();
  try {
    const userFiles = resolveFiles(config.files);
    logger.info(`Resolved ${userFiles.length} file(s)`);

    if (userFiles.length === 0) {
      spinner.info("No files resolved, nothing to back up");
      return;
    }

    const files = [...userFiles, CONFIG_PATH];

    spinner.text = "Syncing with remote";
    await gitPull(config.repository);

    spinner.text = `Copying ${files.length} file(s) to staging`;
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

function tildePath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? "~" + filePath.slice(home.length) : filePath;
}

async function status(): Promise<void> {
  const scheduled = isScheduled();
  console.log();
  console.log(`  Schedule:  ${scheduled ? "active (daily at 02:00)" : "not active"}`);

  try {
    const config = loadConfig();
    console.log(`  Repo:      ${config.repository}`);
    console.log(`  Machine:   ${config.machine}`);
    console.log();

    const spinner = ora("Resolving files").start();
    const userFiles = resolveFiles(config.files);

    if (userFiles.length === 0) {
      spinner.warn("No files resolved. Check your ~/.backdot.json entries.");
      console.log();
      return;
    }

    const files = [...userFiles, CONFIG_PATH];

    spinner.text = "Comparing with remote backup";
    const { backedUp, modified, notBackedUp } = await compareFiles(files, config.machine);
    spinner.stop();

    if (modified.length === 0 && notBackedUp.length === 0) {
      console.log(chalk.green(`  All ${files.length} file(s) are backed up ✓`));
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

      console.log(`  Run ${chalk.bold("backdot --backup")} to back up all changes.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Config error: ${msg}`);
    process.exit(1);
  }

  console.log();
}

function requireMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "Scheduling is only supported on macOS (launchd). Use cron or systemd on Linux.",
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "--init") {
      init();
    } else if (command === "--backup") {
      await backup();
    } else if (command === "--schedule") {
      requireMacOS();
      setupLaunchd();
    } else if (command === "--unschedule") {
      requireMacOS();
      uninstallLaunchd();
    } else if (command === "--status") {
      await status();
    } else if (command === "--restore") {
      await restore(args[1]);
    } else if (command === "--version") {
      console.log(getVersion());
    } else {
      console.log();
      console.log("  Usage: backdot <command>");
      console.log();
      console.log("  Commands:");
      console.log();
      console.log("    --init         Set up backdot for the first time");
      console.log("    --backup       Run a backup now");
      console.log("    --restore [url] Restore files from the backup repo");
      console.log("    --schedule     Install daily backup schedule (macOS launchd)");
      console.log("    --unschedule   Remove the daily backup schedule");
      console.log("    --status       Show schedule and resolved files");
      console.log("    --version      Show version");
      console.log();
      if (command && command !== "--help") {
        console.error(`  Unknown command: ${command}`);
        console.log();
        process.exit(1);
      } else if (!fs.existsSync(CONFIG_PATH)) {
        console.log(`  No config found. Run ${chalk.bold("backdot --init")} to get started.`);
        console.log();
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    console.error(`\n  Error: ${msg}\n`);
    process.exit(1);
  }
}

main();

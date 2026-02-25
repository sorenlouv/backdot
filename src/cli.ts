#!/usr/bin/env node

import ora from "ora";
import { loadConfig } from "./config.js";
import { resolveFiles } from "./resolve.js";
import { copyToStaging } from "./staging.js";
import { gitSync } from "./git.js";
import { restore } from "./restore.js";
import { setupLaunchd, uninstallLaunchd, isScheduled } from "./plist.js";
import { logger } from "./log.js";

async function backup(): Promise<void> {
  logger.info("Starting backup");
  const config = loadConfig();
  logger.info(`Repository: ${config.repository}`);

  const spinner = ora("Resolving files").start();
  const files = resolveFiles(config.files);
  logger.info(`Resolved ${files.length} file(s)`);

  if (files.length === 0) {
    spinner.info("No files resolved, nothing to back up");
    return;
  }

  spinner.text = `Copying ${files.length} file(s) to staging`;
  copyToStaging(files);

  spinner.text = "Pushing to remote";
  await gitSync(config.repository);

  spinner.succeed("Backup complete");
  console.log();

  logger.info("Backup complete");
}

function status(): void {
  const scheduled = isScheduled();
  console.log();
  console.log(`  Schedule:  ${scheduled ? "active (daily at 02:00)" : "not active"}`);

  try {
    const config = loadConfig();
    console.log(`  Repo:      ${config.repository}`);
    console.log();

    const spinner = ora("Resolving files").start();
    const files = resolveFiles(config.files);

    if (files.length === 0) {
      spinner.warn("No files resolved. Check your ~/.backdot.json entries.");
    } else {
      spinner.succeed(`${files.length} file(s) resolved`);
      console.log();
      for (const file of files) {
        console.log(`  ${file}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Config error: ${msg}`);
    process.exit(1);
  }

  console.log();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "--backup") {
      await backup();
    } else if (command === "--schedule") {
      setupLaunchd();
    } else if (command === "--unschedule") {
      uninstallLaunchd();
    } else if (command === "--status") {
      status();
    } else if (command === "--restore") {
      await restore();
    } else {
      console.log();
      console.log("  Usage: backdot <command>");
      console.log();
      console.log("  Commands:");
      console.log();
      console.log("    --backup       Run a backup now");
      console.log("    --restore      Restore files from the backup repo");
      console.log("    --schedule     Install daily backup schedule (macOS launchd)");
      console.log("    --unschedule   Remove the daily backup schedule");
      console.log("    --status       Show schedule and resolved files");
      console.log();
      if (command && command !== "--help") {
        console.error(`  Unknown command: ${command}`);
        console.log();
        process.exit(1);
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

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import { loadConfig, CONFIG_PATH } from "./config.js";
import { resolveFiles } from "./resolve.js";
import { cleanStaging, copyToStaging, writeRepoReadme } from "./staging.js";
import { gitPull, gitCommitAndPush } from "./git.js";
import { restore } from "./restore.js";
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
    writeRepoReadme();

    spinner.text = "Pushing to remote";
    await gitCommitAndPush();

    spinner.succeed("Backup complete");
    console.log();
  } catch (err) {
    spinner.fail("Backup failed");
    throw err;
  }

  logger.info("Backup complete");
}

function status(): void {
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
    } else {
      const files = [...userFiles, CONFIG_PATH];
      spinner.stop();
      console.log(`${files.length} file(s) resolved:`);
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

function requireMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("Scheduling is only supported on macOS (launchd). Use cron or systemd on Linux.");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "--backup") {
      await backup();
    } else if (command === "--schedule") {
      requireMacOS();
      setupLaunchd();
    } else if (command === "--unschedule") {
      requireMacOS();
      uninstallLaunchd();
    } else if (command === "--status") {
      status();
    } else if (command === "--restore") {
      await restore();
    } else if (command === "--version") {
      console.log(getVersion());
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
      console.log("    --version      Show version");
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

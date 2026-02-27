#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import chalk from "chalk";
import { CONFIG_PATH } from "./config.js";
import { backup } from "./commands/backup.js";
import { status } from "./commands/status.js";
import { schedule, unschedule } from "./commands/schedule.js";
import { restore } from "./commands/restore.js";
import { history } from "./commands/history.js";
import { init } from "./commands/init.js";
import { logger } from "./log.js";
import { sendNotification } from "./notify.js";

function getVersion(): string {
  const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function printHelp(): void {
  console.log();
  console.log("  Usage: backdot <command>");
  console.log();
  console.log("  Commands:");
  console.log();
  console.log("    --init                       Set up backdot for the first time");
  console.log("    --backup                     Run a backup now");
  console.log("    --restore [url]              Restore files from the backup repo");
  console.log("    --restore [url] --commit <sha>  Restore from a specific backup commit");
  console.log("    --restore [url] --yes (-y)      Accept defaults without prompting");
  console.log("    --history [url]              Browse and restore a previous backup");
  console.log("    --schedule                   Install daily backup schedule (macOS launchd)");
  console.log("    --unschedule                 Remove the daily backup schedule");
  console.log("    --status                     Show schedule and resolved files");
  console.log("    --version                    Show version");
  console.log();
}

async function main(): Promise<void> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        init: { type: "boolean" },
        backup: { type: "boolean" },
        restore: { type: "boolean" },
        history: { type: "boolean" },
        schedule: { type: "boolean" },
        unschedule: { type: "boolean" },
        status: { type: "boolean" },
        version: { type: "boolean" },
        help: { type: "boolean" },
        commit: { type: "string" },
        yes: { type: "boolean", short: "y" },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Error: ${msg}\n`);
    printHelp();
    process.exit(1);
  }

  try {
    if (values.init) {
      init();
    } else if (values.backup) {
      await backup();
    } else if (values.schedule) {
      schedule();
    } else if (values.unschedule) {
      unschedule();
    } else if (values.status) {
      await status();
    } else if (values.restore) {
      await restore(positionals[0], values.commit as string | undefined, {
        yes: !!values.yes,
      });
    } else if (values.history) {
      await history(positionals[0]);
    } else if (values.version) {
      console.log(getVersion());
    } else {
      printHelp();
      if (!fs.existsSync(CONFIG_PATH)) {
        console.log(`  No config found. Run ${chalk.bold("backdot --init")} to get started.`);
        console.log();
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    console.error(`\n  Error: ${msg}\n`);
    if (!process.stdout.isTTY) {
      sendNotification("Backdot", `Backup failed: ${msg}`);
    }
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { CONFIG_PATH } from "./config.js";
import { backup } from "./commands/backup.js";
import { status } from "./commands/status.js";
import { schedule, unschedule } from "./commands/schedule.js";
import { restore } from "./commands/restore.js";
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "--init") {
      init();
    } else if (command === "--backup") {
      await backup();
    } else if (command === "--schedule") {
      schedule();
    } else if (command === "--unschedule") {
      unschedule();
    } else if (command === "--status") {
      await status();
    } else if (command === "--restore") {
      const url = args[1];
      if (url?.startsWith("--")) {
        throw new Error(`Invalid repository URL: "${url}". Did you mean to pass a Git URL?`);
      }
      await restore(url);
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
    if (!process.stdout.isTTY) {
      sendNotification("Backdot", `Backup failed: ${msg}`);
    }
    process.exit(1);
  }
}

main();

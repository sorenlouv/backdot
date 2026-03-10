#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import cac from "cac";
import chalk from "chalk";
import { CONFIG_PATH } from "./config.js";
import { backup } from "./commands/backup.js";
import { status } from "./commands/status.js";
import { schedule, unschedule } from "./commands/schedule.js";
import { restore } from "./commands/restore.js";
import { history } from "./commands/history.js";
import { init } from "./commands/init.js";
import { checkRepo } from "./commands/checkRepo.js";
import { getScheduleAndEncryptionFileStatus } from "./commands/getScheduleAndEncryptionFileStatus.js";
import { getLastBackupTimestamp } from "./commands/getLastBackupTimestamp.js";
import { setPassword } from "./commands/setPassword.js";
import { removePasswordFile } from "./commands/removePassword.js";
import { printPaths } from "./commands/paths.js";
import { logger } from "./log.js";
import { errorMessage } from "./utils.js";
import { sendNotification } from "./notify.js";

function getVersion(): string {
  const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../package.json");
  try {
    const packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const cli = cac("backdot");

cli.command("init", "Set up backdot for the first time").action(() => init());

cli.command("backup", "Run a backup now").action(async () => {
  await backup();
});

cli
  .command("restore [url]", "Restore files")
  .option("--commit <sha>", "Restore from a specific backup commit")
  .option("-y, --yes", "Accept defaults without prompting")
  .action(async (url: string | undefined, options: { commit?: string; yes?: boolean }) => {
    await restore({ repoUrl: url, commit: options.commit, yes: !!options.yes });
  });

cli
  .command("history [url]", "List and restore a previous backup")
  .action(async (url: string | undefined) => {
    await history(url);
  });

cli.command("schedule", "Schedule daily backup").action(() => schedule());

cli.command("unschedule", "Unschedule the daily backup").action(() => unschedule());

cli.command("status", "Show the status of the backup").action(async () => {
  await status();
});

cli.command("ui:check-repo <url>", "").action(async (url: string) => {
  await checkRepo(url);
});

cli.command("ui:get-schedule-and-encryption-file-status", "").action(() => {
  getScheduleAndEncryptionFileStatus();
});

cli.command("ui:get-last-backup-timestamp", "").action(() => {
  getLastBackupTimestamp();
});

cli.command("ui:set-password", "").action(async () => {
  await setPassword();
});

cli.command("ui:remove-password-file", "").action(() => {
  removePasswordFile();
});

cli.command("ui:paths", "").action(() => {
  printPaths();
});

cli.command("", "").action(() => {
  cli.outputHelp();
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`  No config found. Run ${chalk.bold("backdot init")} to get started.\n`);
  }
});

// cac auto-adds a --help flag; remove its redundant section from help output
cli.help((sections) => sections.filter((s) => !s.body?.includes("--help")));
cli.version(getVersion());

async function main(): Promise<void> {
  try {
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } catch (err) {
    const msg = errorMessage(err);
    logger.error(msg);
    console.error(`\n  Error: ${msg}\n`);
    const isRunningInBackground = !process.stdout.isTTY;
    if (isRunningInBackground) {
      sendNotification("Backdot", `Backup failed: ${msg}`);
    }
    process.exit(1);
  }
}

main();

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
  .option("--machine <name>", "Restore a specific machine")
  .option("--commit <sha>", "Restore from a specific backup commit")
  .option(
    "--no-overwrite",
    "Restore only new files; never overwrite existing ones (non-interactive)",
  )
  .option("--dry-run", "Preview what would be restored without writing any files")
  .action(
    async (
      url: string | undefined,
      options: { machine?: string; commit?: string; overwrite?: boolean; dryRun?: boolean },
    ) => {
      await restore({
        repoUrl: url,
        commit: options.commit,
        // cac defaults `overwrite` to true and `--no-overwrite` flips it to false.
        skipExisting: options.overwrite === false,
        machine: options.machine,
        dryRun: Boolean(options.dryRun),
      });
    },
  );

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

cli.command("", "").action(() => {
  cli.outputHelp();
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`  No config found. Run ${chalk.bold("backdot init")} to get started.\n`);
  }
});

cli.help((sections) =>
  sections.filter((section) => {
    if (!section.body) {
      return true;
    }
    const contentLines = section.body.split("\n").filter((line) => line.trim() !== "");
    const listsOnlyHelpAndVersion = contentLines.every((line) => /--(help|version)/.test(line));
    return !listsOnlyHelpAndVersion;
  }),
);
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

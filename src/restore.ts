import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ora from "ora";
import { checkbox } from "@inquirer/prompts";
import { loadConfig } from "./config.js";
import { gitPull } from "./git.js";
import { STAGING_DIR, machineDir } from "./staging.js";
import { logger } from "./log.js";

const HOME = os.homedir();

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function listMachines(): string[] {
  if (!fs.existsSync(STAGING_DIR)) return [];
  return fs
    .readdirSync(STAGING_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== ".git")
    .map((e) => e.name);
}

export async function restore(): Promise<void> {
  logger.info("Starting restore");
  const config = loadConfig();
  const baseDir = machineDir(config.machine);

  const spinner = ora("Fetching latest backup").start();
  await gitPull(config.repository);
  spinner.text = "Resolving files";

  if (!fs.existsSync(baseDir)) {
    spinner.stop();
    const available = listMachines();
    if (available.length > 0) {
      console.log(`\n  No backup found for machine "${config.machine}".`);
      console.log(`  Available machines: ${available.join(", ")}\n`);
    } else {
      console.log(`\n  No backup found for machine "${config.machine}". The repository is empty.\n`);
    }
    return;
  }

  const stagedFiles = walkDir(baseDir);
  logger.info(`Found ${stagedFiles.length} file(s) in backup repository`);

  if (stagedFiles.length === 0) {
    spinner.stop();
    console.log("No files found in backup repository.");
    return;
  }

  const fileMappings = stagedFiles.map((src) => {
    const rel = path.relative(baseDir, src);
    return { src, dest: path.join(HOME, rel), rel };
  });

  const existing = fileMappings.filter((f) => fs.existsSync(f.dest));
  const fresh = fileMappings.filter((f) => !fs.existsSync(f.dest));
  logger.info(`${fresh.length} new, ${existing.length} already exist`);

  spinner.stop();
  console.log();

  if (fresh.length > 0) {
    console.log(`${fresh.length} new file(s) to restore:`);
    console.log();
    for (const f of fresh) {
      console.log(`  ${f.rel}`);
    }
    console.log();
  }

  let toRestore = fresh;

  if (existing.length > 0) {
    const selected = await checkbox({
      message: `${existing.length} file(s) already exist. Select which to overwrite:`,
      choices: existing.map((f) => ({
        name: f.rel,
        value: f,
        checked: true,
      })),
    });
    toRestore = [...fresh, ...selected];
    console.log();
  }

  if (toRestore.length === 0) {
    console.log("No files selected for restore.");
    return;
  }

  const copySpinner = ora("Restoring files").start();
  for (const { src, dest } of toRestore) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  copySpinner.succeed(`Restored ${toRestore.length} file(s)`);
  console.log();

  logger.info(`Restored ${toRestore.length} file(s)`);
}

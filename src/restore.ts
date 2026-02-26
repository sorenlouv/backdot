import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ora from "ora";
import { checkbox, select } from "@inquirer/prompts";
import { loadConfig } from "./config.js";
import { gitPull } from "./git.js";
import { STAGING_DIR, machineDir } from "./staging.js";
import { logger } from "./log.js";

const HOME = os.homedir();

function walkDir(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walkDir(full) : [full];
    });
}

function listMachines(): string[] {
  if (!fs.existsSync(STAGING_DIR)) return [];
  return fs
    .readdirSync(STAGING_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== ".git")
    .map((e) => e.name);
}

async function resolveRepoAndMachine(
  repoUrl?: string,
): Promise<{ repository: string; machine: string }> {
  if (!repoUrl) {
    const config = loadConfig();
    return { repository: config.repository, machine: config.machine };
  }

  const spinner = ora("Cloning backup repository").start();
  await gitPull(repoUrl);
  spinner.stop();

  const machines = listMachines();
  if (machines.length === 0) {
    throw new Error("The backup repository is empty (no machine directories found).");
  }

  let machine: string;
  if (machines.length === 1) {
    machine = machines[0];
  } else {
    machine = await select({
      message: "Multiple machines found. Which one do you want to restore?",
      choices: machines.map((m) => ({ name: m, value: m })),
    });
  }

  return { repository: repoUrl, machine };
}

export async function restore(repoUrl?: string): Promise<void> {
  logger.info("Starting restore");

  const { repository, machine } = await resolveRepoAndMachine(repoUrl);

  const spinner = ora("Fetching latest backup").start();
  const baseDir = machineDir(machine);

  if (!repoUrl) {
    await gitPull(repository);
  }
  spinner.text = "Resolving files";

  if (!fs.existsSync(baseDir)) {
    spinner.stop();
    const available = listMachines();
    if (available.length > 0) {
      console.log(`\n  No backup found for machine "${machine}".`);
      console.log(`  Available machines: ${available.join(", ")}\n`);
    } else {
      console.log(`\n  No backup found for machine "${machine}". The repository is empty.\n`);
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

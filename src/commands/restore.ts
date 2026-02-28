import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ora from "ora";
import { checkbox, select, Separator } from "@inquirer/prompts";
import { loadConfig } from "../config.js";
import { gitPull } from "../git.js";
import { STAGING_DIR, machineDir } from "../staging.js";
import { logger } from "../log.js";
import { pluralize } from "../utils.js";
import { decrypt, deriveKey } from "../crypto/encryption.js";
import { resolvePassword, offerToSaveKeyFile, ENC_SUFFIX } from "../crypto/password.js";

const HOME = os.homedir();

function listFilesRecursively(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFilesRecursively(fullPath) : [fullPath];
    });
}

function listMachines(): string[] {
  if (!fs.existsSync(STAGING_DIR)) {
    return [];
  }
  return fs
    .readdirSync(STAGING_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ".git")
    .map((entry) => entry.name);
}

async function resolveRepoAndMachine(
  repoUrl?: string,
  commit?: string,
): Promise<{ repository: string; machine: string }> {
  if (!repoUrl) {
    const config = loadConfig();
    return { repository: config.repository, machine: config.machine };
  }

  const spinner = ora("Cloning backup repository").start();
  try {
    await gitPull(repoUrl, commit);
  } catch (err) {
    spinner.fail("Failed to clone backup repository");
    throw err;
  }
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
      loop: false,
      choices: machines.map((m) => ({ name: m, value: m })),
    });
  }

  return { repository: repoUrl, machine };
}

export async function restore({
  repoUrl,
  commit,
  yes,
}: {
  repoUrl?: string;
  commit?: string;
  yes?: boolean;
} = {}): Promise<void> {
  logger.info("Starting restore");

  const { repository, machine } = await resolveRepoAndMachine(repoUrl, commit);

  const spinner = ora("Fetching latest backup").start();
  const baseDir = machineDir(machine);

  try {
    if (!repoUrl) {
      await gitPull(repository, commit);
    }
  } catch (err) {
    spinner.fail("Failed to fetch latest backup");
    throw err;
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

  const stagedFiles = listFilesRecursively(baseDir);
  logger.info(`Found ${pluralize(stagedFiles.length, "file")} in backup repository`);

  if (stagedFiles.length === 0) {
    spinner.stop();
    console.log("No files found in backup repository.");
    return;
  }

  const fileMappings = stagedFiles.map((stagedFilePath) => {
    let relativePath = path.relative(baseDir, stagedFilePath);
    if (relativePath.endsWith(ENC_SUFFIX)) {
      relativePath = relativePath.slice(0, -ENC_SUFFIX.length);
    }
    return { src: stagedFilePath, dest: path.join(HOME, relativePath), rel: relativePath };
  });

  const filesAlreadyOnDisk = fileMappings.filter((file) => fs.existsSync(file.dest));
  const newFiles = fileMappings.filter((file) => !fs.existsSync(file.dest));
  logger.info(`${newFiles.length} new, ${filesAlreadyOnDisk.length} already exist`);

  spinner.stop();
  console.log();

  type FileMapping = (typeof fileMappings)[number];

  let filesToRestore: FileMapping[];

  if (yes) {
    filesToRestore = newFiles;
    if (filesAlreadyOnDisk.length > 0) {
      console.log(
        `  Skipped ${pluralize(filesAlreadyOnDisk.length, "existing file")}. Run without --yes to select them.`,
      );
      console.log();
    }
  } else {
    const choices: Array<{ name: string; value: FileMapping; checked: boolean } | Separator> = [];

    if (newFiles.length > 0) {
      choices.push(new Separator(`── New files (${newFiles.length}) ──`));
      for (const file of newFiles) {
        choices.push({ name: file.rel, value: file, checked: true });
      }
    }

    if (filesAlreadyOnDisk.length > 0) {
      choices.push(
        new Separator(`── Existing files — will overwrite (${filesAlreadyOnDisk.length}) ──`),
      );
      for (const file of filesAlreadyOnDisk) {
        choices.push({ name: file.rel, value: file, checked: false });
      }
    }

    filesToRestore = await checkbox({
      message: "Select files to restore:",
      loop: false,
      choices,
    });
    console.log();
  }

  if (filesToRestore.length === 0) {
    console.log("No files selected for restore.");
    return;
  }

  let password: string | undefined;
  const hasEncryptedFiles = filesToRestore.some(({ src }) => src.endsWith(ENC_SUFFIX));

  if (hasEncryptedFiles) {
    const result = await resolvePassword();
    password = result.password;
  }

  const derivedKey = password ? deriveKey(password) : undefined;

  const restoreSpinner = ora("Restoring files").start();
  for (const { src, dest } of filesToRestore) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (derivedKey && src.endsWith(ENC_SUFFIX)) {
      const content = fs.readFileSync(src);
      fs.writeFileSync(dest, decrypt(content, derivedKey));
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  restoreSpinner.succeed(`Restored ${pluralize(filesToRestore.length, "file")}`);
  console.log();

  if (password) {
    await offerToSaveKeyFile(password);
  }

  logger.info(`Restored ${pluralize(filesToRestore.length, "file")}`);
}

import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import { checkbox, select, Separator } from "@inquirer/prompts";
import { loadConfig } from "../config.js";
import { gitPull } from "../git.js";
import { STAGING_DIR, machineDir, getRestoreTarget } from "../staging.js";
import { POST_RESTORE_HOOK_PATH } from "../paths.js";
import { runPostRestoreHook } from "../postRestoreHook.js";
import { logger } from "../log.js";
import { pluralize } from "../utils.js";
import { decrypt, deriveKey } from "../crypto/encryption.js";
import { resolvePassword, offerToSaveKeyFile, ENC_SUFFIX } from "../crypto/password.js";

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

function formatMachineList(machines: string[]): string {
  return machines.map((machine) => `    - ${machine}`).join("\n");
}

async function resolveRepoAndMachine(
  repoUrl?: string,
  commit?: string,
  machineOverride?: string,
): Promise<{ repository: string; machine: string }> {
  if (!repoUrl) {
    const config = loadConfig();
    // An explicit --machine wins over the configured machine; the repository
    // still comes from config.
    return { repository: config.repository, machine: machineOverride ?? config.machine };
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

  if (machineOverride) {
    if (!machines.includes(machineOverride)) {
      throw new Error(
        `No backup found for machine "${machineOverride}".\n  Available machines:\n${formatMachineList(machines)}`,
      );
    }
    return { repository: repoUrl, machine: machineOverride };
  }

  if (machines.length === 1) {
    return { repository: repoUrl, machine: machines[0] };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `Multiple machines found in the backup repository. Re-run with --machine <name>:\n${formatMachineList(machines)}`,
    );
  }

  const machine = await select({
    message: "Multiple machines found. Which one do you want to restore?",
    loop: false,
    choices: machines.map((machine) => ({ name: machine, value: machine })),
  });

  return { repository: repoUrl, machine };
}

export async function restore({
  repoUrl,
  commit,
  yes,
  machine: machineOverride,
}: {
  repoUrl?: string;
  commit?: string;
  yes?: boolean;
  machine?: string;
} = {}): Promise<void> {
  logger.info("Starting restore");

  const { repository, machine } = await resolveRepoAndMachine(repoUrl, commit, machineOverride);

  const spinner = ora("Fetching latest backup").start();
  const machineStagingDir = machineDir(machine);

  try {
    if (!repoUrl) {
      await gitPull(repository, commit);
    }
  } catch (err) {
    spinner.fail("Failed to fetch latest backup");
    throw err;
  }
  spinner.text = "Resolving files";

  if (!fs.existsSync(machineStagingDir)) {
    spinner.stop();
    const availableMachines = listMachines();
    if (availableMachines.length > 0) {
      console.log(`\n  No backup found for machine "${machine}".`);
      console.log(`  Available machines: ${availableMachines.join(", ")}\n`);
    } else {
      console.log(`\n  No backup found for machine "${machine}". The repository is empty.\n`);
    }
    return;
  }

  const backupFiles = listFilesRecursively(machineStagingDir);
  logger.info(`Found ${pluralize(backupFiles.length, "file")} in backup repository`);

  if (backupFiles.length === 0) {
    spinner.stop();
    console.log("No files found in backup repository.");
    return;
  }

  const fileMappings = backupFiles.map((backupFilePath) => {
    let machineRelativePath = path.relative(machineStagingDir, backupFilePath);
    if (machineRelativePath.endsWith(ENC_SUFFIX)) {
      machineRelativePath = machineRelativePath.slice(0, -ENC_SUFFIX.length);
    }
    const { destination, displayPath } = getRestoreTarget(machineRelativePath);
    return { src: backupFilePath, dest: destination, displayPath };
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
        choices.push({ name: file.displayPath, value: file, checked: true });
      }
    }

    if (filesAlreadyOnDisk.length > 0) {
      choices.push(
        new Separator(`── Existing files — will overwrite (${filesAlreadyOnDisk.length}) ──`),
      );
      for (const file of filesAlreadyOnDisk) {
        choices.push({ name: file.displayPath, value: file, checked: false });
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

  // Run the hook only if it was among the files just restored, so we
  // never execute a stale on-disk script the user chose not to restore.
  if (filesToRestore.some(({ dest }) => dest === POST_RESTORE_HOOK_PATH)) {
    runPostRestoreHook();
  }
}

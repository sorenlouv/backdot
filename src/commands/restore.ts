import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import ora from "ora";
import chalk from "chalk";
import { checkbox, select, Separator } from "@inquirer/prompts";
import { loadConfig } from "../config.js";
import { gitPull } from "../git.js";
import {
  STAGING_DIR,
  machineDir,
  getRestoreTarget,
  HOME_NAMESPACE,
  ROOT_NAMESPACE,
} from "../staging.js";
import { POST_RESTORE_HOOK_PATH } from "../paths.js";
import { runPostRestoreHook } from "../postRestoreHook.js";
import { logger } from "../log.js";
import { pluralize } from "../utils.js";
import { decrypt, deriveKey, type DerivedKey } from "../crypto/encryption.js";
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

// ─── Dry-run preview ────────────────────────────────────────────────────────

interface RestoreFile {
  src: string;
  dest: string;
  displayPath: string;
}

// Largest file we render an inline diff for; bigger files just report their size.
const MAX_DIFF_BYTES = 200_000;
const DIFF_RULE = "─".repeat(60);

// Built without a literal ESC byte so eslint's no-control-regex rule stays happy.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// The exact bytes `restore` would write for this file (decrypting first when the
// backup is encrypted).
function restoredContent(file: RestoreFile, derivedKey?: DerivedKey): Buffer {
  const raw = fs.readFileSync(file.src);
  if (file.src.endsWith(ENC_SUFFIX) && derivedKey) {
    return decrypt(raw, derivedKey);
  }
  return raw;
}

type ChangeVerdict = "changed" | "unchanged" | "unknown";

function classifyExisting(file: RestoreFile, derivedKey?: DerivedKey): ChangeVerdict {
  // Encrypted backup but no password: we can't tell whether the contents differ.
  if (file.src.endsWith(ENC_SUFFIX) && !derivedKey) {
    return "unknown";
  }
  const current = fs.readFileSync(file.dest);
  return restoredContent(file, derivedKey).equals(current) ? "unchanged" : "changed";
}

// Diff the on-disk file (old) against the bytes restore would write (new) using
// git, which gives us familiar unified hunks and free binary detection. Reused
// because the staging dir is already a git repo and git is a hard dependency.
function runGitDiff(diskPath: string, candidatePath: string): { binary: boolean; body: string } {
  // Match git's coloring to the rest of the CLI's (chalk also honors a TTY,
  // FORCE_COLOR, and NO_COLOR), so the diff isn't colored when our output isn't.
  const colorFlag = chalk.level > 0 ? "--color=always" : "--no-color";
  let raw = "";
  try {
    // Exit 0 means identical; callers only diff files known to differ, but if it
    // happens there is simply nothing to show.
    execFileSync("git", ["diff", "--no-index", colorFlag, diskPath, candidatePath], {
      encoding: "utf-8",
    });
  } catch (err) {
    // `git diff --no-index` exits 1 when the files differ — the expected case.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1 && typeof e.stdout === "string") {
      raw = e.stdout;
    } else {
      throw err;
    }
  }

  const plain = raw.split("\n").map(stripAnsi);
  if (plain.some((line) => line.startsWith("Binary files ") && line.endsWith(" differ"))) {
    return { binary: true, body: "" };
  }

  // Drop git's file headers (diff --git, index, ---, +++) and keep the hunks.
  // Detect the first hunk on the ANSI-stripped copy, then slice the original
  // (still-colored) lines at that index so color survives in a TTY.
  const lines = raw.split("\n");
  const firstHunk = plain.findIndex((line) => line.startsWith("@@"));
  const body = firstHunk === -1 ? raw.trimEnd() : lines.slice(firstHunk).join("\n").trimEnd();
  return { binary: false, body };
}

function printFileDiff(file: RestoreFile, derivedKey?: DerivedKey): void {
  console.log(chalk.dim(`  ${DIFF_RULE}`));
  console.log(`  ${chalk.bold(file.displayPath)}`);
  console.log(chalk.dim(`  ${DIFF_RULE}`));

  if (file.src.endsWith(ENC_SUFFIX) && !derivedKey) {
    console.log("  (encrypted — enter the password to see the diff)");
    console.log();
    return;
  }

  const candidate = restoredContent(file, derivedKey);
  const largest = Math.max(fileSize(file.dest), candidate.length);
  if (largest > MAX_DIFF_BYTES) {
    console.log(`  (file too large to diff — ${Math.round(largest / 1024)} KB)`);
    console.log();
    return;
  }

  // Plaintext backups already hold the exact bytes on disk; for encrypted ones we
  // materialise the decrypted bytes into a temp file so git can diff real paths.
  let candidatePath = file.src;
  let tmpDir: string | undefined;
  if (file.src.endsWith(ENC_SUFFIX)) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-diff-"));
    candidatePath = path.join(tmpDir, path.basename(file.dest));
    fs.writeFileSync(candidatePath, candidate);
  }

  try {
    const { binary, body } = runGitDiff(file.dest, candidatePath);
    if (binary) {
      console.log("  (binary file — contents differ)");
    } else if (body) {
      console.log(
        body
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
      );
    }
  } finally {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  console.log();
}

// Best-effort one-line description of the commit being restored from.
function describeRestoredCommit(): string | undefined {
  try {
    return (
      execFileSync("git", ["-C", STAGING_DIR, "log", "-1", "--format=%h  %cs"], {
        encoding: "utf-8",
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function previewRestore(opts: {
  repository: string;
  machine: string;
  skipExisting: boolean;
  newFiles: RestoreFile[];
  existingFiles: RestoreFile[];
}): Promise<void> {
  const { repository, machine, skipExisting, newFiles, existingFiles } = opts;

  console.log(chalk.bold("  Dry run — no files will be written."));
  console.log();
  console.log(`  Source:   ${repository}`);
  console.log(`  Machine:  ${machine}`);
  const commitDescription = describeRestoredCommit();
  if (commitDescription) {
    console.log(`  Commit:   ${commitDescription}`);
  }
  console.log();

  // Resolve the key once, only if we need it to compare existing encrypted files.
  // Degrade gracefully (no compare/diff) when it can't be obtained — a dry run
  // should never hard-fail on a missing password.
  let derivedKey: DerivedKey | undefined;
  if (!skipExisting && existingFiles.some((file) => file.src.endsWith(ENC_SUFFIX))) {
    try {
      derivedKey = deriveKey((await resolvePassword()).password);
    } catch {
      derivedKey = undefined;
    }
  }

  const changed: RestoreFile[] = [];
  const unchanged: RestoreFile[] = [];
  const unknown: RestoreFile[] = [];
  if (!skipExisting) {
    for (const file of existingFiles) {
      const verdict = classifyExisting(file, derivedKey);
      const bucket =
        verdict === "changed" ? changed : verdict === "unchanged" ? unchanged : unknown;
      bucket.push(file);
    }
  }

  if (newFiles.length > 0) {
    console.log(chalk.green(`  New — will be created (${newFiles.length}):`));
    for (const file of newFiles) {
      console.log(`        ${file.displayPath}`);
    }
    console.log();
  }

  if (skipExisting) {
    if (existingFiles.length > 0) {
      console.log(
        `  ${pluralize(existingFiles.length, "existing file")} left untouched (--no-overwrite).`,
      );
      console.log();
    }
  } else {
    if (changed.length > 0) {
      console.log(
        chalk.yellow(`  Changed — restoring overwrites your local copy (${changed.length}):`),
      );
      for (const file of changed) {
        console.log(`        ${file.displayPath}`);
      }
      console.log();
      for (const file of changed) {
        printFileDiff(file, derivedKey);
      }
    }

    if (unknown.length > 0) {
      console.log(
        chalk.yellow(`  Existing, encrypted — not compared, no password (${unknown.length}):`),
      );
      for (const file of unknown) {
        console.log(`        ${file.displayPath}`);
      }
      console.log();
    }

    if (unchanged.length > 0) {
      console.log(chalk.dim(`  Unchanged — identical to backup (${unchanged.length}):`));
      for (const file of unchanged) {
        console.log(chalk.dim(`        ${file.displayPath}`));
      }
      console.log();
    }
  }

  if ([...newFiles, ...existingFiles].some((file) => file.dest === POST_RESTORE_HOOK_PATH)) {
    console.log(`  This backup includes a post-restore hook (${POST_RESTORE_HOOK_PATH}),`);
    console.log(`  which runs after restore if you restore it.`);
    console.log();
  }

  const summary = [`${newFiles.length} to create`];
  if (skipExisting) {
    if (existingFiles.length > 0) {
      summary.push(`${existingFiles.length} skipped`);
    }
  } else {
    summary.push(`${changed.length} to overwrite`);
    if (unknown.length > 0) {
      summary.push(`${unknown.length} not compared`);
    }
    summary.push(`${unchanged.length} unchanged`);
  }
  console.log(`  ${summary.join(", ")}.`);
  console.log(`  Re-run without ${chalk.bold("--dry-run")} to apply.`);
  console.log();
}

export async function restore({
  repoUrl,
  commit,
  skipExisting,
  machine: machineOverride,
  dryRun,
}: {
  repoUrl?: string;
  commit?: string;
  skipExisting?: boolean;
  machine?: string;
  dryRun?: boolean;
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

  // Restore only the two managed namespaces; anything else in the machine dir
  // (e.g. a user-authored README.md) is documentation, not a file to restore.
  const backupFiles = [HOME_NAMESPACE, ROOT_NAMESPACE]
    .map((namespace) => path.join(machineStagingDir, namespace))
    .filter((namespaceDir) => fs.existsSync(namespaceDir))
    .flatMap(listFilesRecursively);
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

  // A dry run classifies the backup against what's on disk and prints the result
  // (with diffs for files that would be overwritten) without touching any file,
  // running the post-restore hook, or offering to save the key file. It also
  // returns before the interactive picker, so it works without a TTY.
  if (dryRun) {
    await previewRestore({
      repository,
      machine,
      skipExisting: skipExisting ?? false,
      newFiles,
      existingFiles: filesAlreadyOnDisk,
    });
    logger.info("Dry run complete; no files written");
    return;
  }

  type FileMapping = (typeof fileMappings)[number];

  let filesToRestore: FileMapping[];

  if (skipExisting) {
    filesToRestore = newFiles;
    if (filesAlreadyOnDisk.length > 0) {
      console.log(
        `  Skipped ${pluralize(filesAlreadyOnDisk.length, "existing file")}. Run without --no-overwrite to select them.`,
      );
      console.log();
    }
  } else {
    if (!process.stdin.isTTY) {
      throw new Error(
        "Selecting files to restore is interactive.\n" +
          "  Re-run with --yes to restore new files non-interactively (existing files are skipped),\n" +
          "  or run in a terminal to choose which files to restore.",
      );
    }

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

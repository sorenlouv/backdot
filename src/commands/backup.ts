import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import { loadConfig, CONFIG_PATH } from "../config.js";
import { POST_RESTORE_HOOK_PATH } from "../paths.js";
import { resolveFiles } from "../resolveFiles.js";
import { cleanStaging, copyToStaging, writeRepoReadme, machineDir } from "../staging.js";
import { gitPull, gitCommitAndPush } from "../git.js";
import { logger } from "../log.js";
import { pluralize } from "../utils.js";
import { parseGitHubRepoUrl, fetchRepoAccess, resolveGitHubToken } from "../github.js";
import { confirm } from "@inquirer/prompts";
import { decrypt, deriveKey, type DerivedKey } from "../crypto/encryption.js";
import {
  resolvePassword,
  offerToSaveKeyFile,
  confirmPassword,
  ENC_SUFFIX,
} from "../crypto/password.js";

function findEncryptedFile(dir: string): string | null {
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const encryptedFile = findEncryptedFile(fullPath);
      if (encryptedFile) {
        return encryptedFile;
      }
    } else if (entry.name.endsWith(ENC_SUFFIX)) {
      return fullPath;
    }
  }
  return null;
}

export async function backup(): Promise<void> {
  logger.info("Starting backup");
  const config = loadConfig();
  logger.info(`Repository: ${config.repository}`);
  logger.info(`Machine: ${config.machine}`);

  let password: string | undefined;
  let derivedKey: DerivedKey | undefined;

  if (config.encrypt) {
    const result = await resolvePassword();
    password = result.password;

    if (result.source === "prompt") {
      await confirmPassword(password);
    }

    derivedKey = deriveKey(password);
  }

  const token = resolveGitHubToken();
  const repo = parseGitHubRepoUrl(config.repository);
  if (!repo) {
    // The config schema guarantees a valid github.com URL, so this is unreachable
    // in practice — kept as a defensive guard.
    throw new Error(`Invalid repository URL: ${config.repository}`);
  }

  const spinner = ora("Verifying GitHub access").start();
  try {
    const { isPrivate } = await fetchRepoAccess(repo, token);
    if (!isPrivate) {
      spinner.fail("Backup refused — repository is public");
      throw new Error(
        `Repository "${config.repository}" is publicly accessible.\n` +
          "Backing up to a public repo would expose sensitive files.\n" +
          "Make the repository private, then try again.",
      );
    }

    spinner.text = "Resolving files";
    const userFiles = resolveFiles(config);
    logger.info(`Resolved ${pluralize(userFiles.length, "file")}`);

    if (userFiles.length === 0) {
      // Don't bail out: the config is still backed up below, and the run still
      // produces a commit. A silent no-op here would be indistinguishable from
      // the backup never running — exactly what we want to avoid.
      logger.warn("No user files resolved — backing up config only");
      spinner.warn("No files matched your config paths — backing up config only");
      spinner.start();
    }

    const files = [...userFiles, CONFIG_PATH];
    // Automatically backup the "post-restore" hook if it exists
    if (fs.existsSync(POST_RESTORE_HOOK_PATH)) {
      files.push(POST_RESTORE_HOOK_PATH);
    }

    spinner.text = "Syncing with remote";
    await gitPull(config.repository, token);

    if (derivedKey) {
      const existingEncryptedFile = findEncryptedFile(machineDir(config.machine));
      if (existingEncryptedFile) {
        spinner.text = "Verifying encryption password";
        const encryptedContent = fs.readFileSync(existingEncryptedFile);
        try {
          decrypt(encryptedContent, derivedKey);
        } catch {
          if (!process.stdin.isTTY) {
            spinner.fail("Backup failed");
            throw new Error(
              "Password does not match the existing backup.\n" +
                "Run interactively to re-encrypt with a new password.",
            );
          }
          spinner.stop();
          const shouldReEncrypt = await confirm({
            message:
              "Password does not match the existing backup. Re-encrypt all files with the new password?",
            default: false,
          });
          if (!shouldReEncrypt) {
            throw new Error("Backup aborted.");
          }
          spinner.start();
        }
      }
    }

    spinner.text = `Copying ${pluralize(files.length, "file")} to staging`;
    cleanStaging(config.machine);
    copyToStaging(files, config.machine, derivedKey);
    writeRepoReadme(config.repository, config.encrypt);

    spinner.text = "Pushing to remote";
    const result = await gitCommitAndPush(token);

    const successMsg = result.commitUrl
      ? `Backup complete → ${result.commitUrl}`
      : "Backup complete";
    spinner.succeed(successMsg);
    console.log();
  } catch (err) {
    spinner.fail("Backup failed");
    throw err;
  }

  if (password) {
    await offerToSaveKeyFile(password);
  }

  logger.info("Backup complete");
}

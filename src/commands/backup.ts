import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import { loadConfig, CONFIG_PATH } from "../config.js";
import { resolveFiles } from "../resolveFiles.js";
import { cleanStaging, copyToStaging, writeRepoReadme, machineDir } from "../staging.js";
import { gitPull, gitCommitAndPush } from "../git.js";
import { logger } from "../log.js";
import { pluralize } from "../utils.js";
import { checkRepoVisibility } from "../repoVisibility.js";
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
  let passwordWasInteractive = false;

  if (config.encrypt) {
    const result = await resolvePassword();
    password = result.password;
    passwordWasInteractive = result.interactive;
    derivedKey = deriveKey(password);
  }

  const spinner = ora("Checking repository visibility").start();
  try {
    const visibility = await checkRepoVisibility(config.repository);
    if (visibility === "public") {
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
      spinner.info("No files resolved, nothing to back up");
      return;
    }

    const files = [...userFiles, CONFIG_PATH];

    spinner.text = "Syncing with remote";
    await gitPull(config.repository);

    if (derivedKey) {
      const existingEncryptedFile = findEncryptedFile(machineDir(config.machine));
      if (existingEncryptedFile) {
        spinner.text = "Verifying encryption password";
        const encryptedContent = fs.readFileSync(existingEncryptedFile);
        try {
          decrypt(encryptedContent, derivedKey);
        } catch {
          spinner.fail("Backup failed");
          throw new Error("Password does not match the existing backup.");
        }
      } else if (passwordWasInteractive) {
        spinner.stop();
        await confirmPassword(password!);
        spinner.start();
      }
    }

    spinner.text = `Copying ${pluralize(files.length, "file")} to staging`;
    cleanStaging(config.machine);
    copyToStaging(files, config.machine, derivedKey);
    writeRepoReadme(config.repository, config.encrypt);

    spinner.text = "Pushing to remote";
    const result = await gitCommitAndPush();

    const successMsg = result?.commitUrl
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

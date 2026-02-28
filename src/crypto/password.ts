import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { password as passwordPrompt, confirm } from "@inquirer/prompts";

export const KEY_FILE_PATH = path.join(os.homedir(), ".backdot.key");
export const ENC_SUFFIX = ".encrypted";

export function checkKeyFilePermissions(): void {
  if (process.platform === "win32") {
    return;
  }
  if (!fs.existsSync(KEY_FILE_PATH)) {
    return;
  }

  const stat = fs.statSync(KEY_FILE_PATH);
  const mode = stat.mode & 0o777;
  const isAccessibleByGroupOrOthers = (mode & 0o077) !== 0;
  if (isAccessibleByGroupOrOthers) {
    throw new Error(
      `Key file ${KEY_FILE_PATH} has overly permissive permissions (${mode.toString(8)}).\n` +
        `  Run: chmod 600 ${KEY_FILE_PATH}`,
    );
  }
}

export function saveKeyFile(password: string): void {
  fs.writeFileSync(KEY_FILE_PATH, password + "\n", { mode: 0o600 });
}

function readKeyFile(): string | null {
  if (!fs.existsSync(KEY_FILE_PATH)) {
    return null;
  }
  checkKeyFilePermissions();
  return fs.readFileSync(KEY_FILE_PATH, "utf-8").trimEnd();
}

export interface PasswordResult {
  password: string;
  interactive: boolean;
}

export async function resolvePassword(): Promise<PasswordResult> {
  const envPassword = process.env.BACKDOT_PASSWORD;
  if (envPassword) {
    return { password: envPassword, interactive: false };
  }

  const filePassword = readKeyFile();
  if (filePassword) {
    return { password: filePassword, interactive: false };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'Encryption is enabled but no password found.\n  Run "backdot backup" interactively to create ~/.backdot.key, or set BACKDOT_PASSWORD.',
    );
  }

  const enteredPassword = await passwordPrompt({ message: "Enter encryption password:" });
  if (!enteredPassword) {
    throw new Error("No password provided.");
  }

  return { password: enteredPassword, interactive: true };
}

export async function confirmPassword(password: string): Promise<void> {
  const confirmedPassword = await passwordPrompt({ message: "Confirm password:" });
  if (confirmedPassword !== password) {
    throw new Error("Passwords do not match.");
  }
}

export async function offerToSaveKeyFile(password: string): Promise<void> {
  if (!process.stdin.isTTY) {
    return;
  }
  if (fs.existsSync(KEY_FILE_PATH)) {
    return;
  }
  if (process.env.BACKDOT_PASSWORD) {
    return;
  }

  const save = await confirm({
    message: "Save password to ~/.backdot.key for automated backups?",
    default: true,
  });

  if (save) {
    saveKeyFile(password);
    console.log(`  Created ${KEY_FILE_PATH} (permissions: 600)`);
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { password as passwordPrompt, confirm } from "@inquirer/prompts";

export const KEY_FILE_PATH = path.join(os.homedir(), ".backdot.key");
export const ENC_SUFFIX = ".encrypted";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

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

export type PasswordSource = "env" | "file" | "prompt";

export interface PasswordResult {
  password: string;
  source: PasswordSource;
}

export async function resolvePassword(): Promise<PasswordResult> {
  const envPassword = process.env.BACKDOT_PASSWORD;
  if (envPassword) {
    return { password: hashPassword(envPassword), source: "env" };
  }

  const filePassword = readKeyFile();
  if (filePassword) {
    return { password: filePassword, source: "file" };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `Encryption is enabled but no password found.\n  Run "backdot backup" interactively to create ${KEY_FILE_PATH}, or set BACKDOT_PASSWORD.`,
    );
  }

  const enteredPassword = await passwordPrompt({ message: "Enter encryption password:" });
  if (!enteredPassword) {
    throw new Error("No password provided.");
  }

  return { password: hashPassword(enteredPassword), source: "prompt" };
}

export async function confirmPassword(hashedPassword: string): Promise<void> {
  const confirmedPassword = await passwordPrompt({ message: "Confirm password:" });
  if (hashPassword(confirmedPassword) !== hashedPassword) {
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
    message: `Save password to ${KEY_FILE_PATH} for automated backups?`,
    default: true,
  });

  if (save) {
    saveKeyFile(password);
    console.log(`  Created ${KEY_FILE_PATH} (permissions: 600)`);
  }
}

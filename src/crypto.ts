import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { password as passwordPrompt, confirm } from "@inquirer/prompts";

const MAGIC = Buffer.from("BDOT");
const VERSION = 0x01;
const HEADER_SIZE = MAGIC.length + 1; // 5 bytes: magic + version
const SALT_SIZE = 32;
const IV_SIZE = 12;
const TAG_SIZE = 16;
const KEY_SIZE = 32;

export const KEY_FILE_PATH = path.join(os.homedir(), ".backdot.key");
export const ENC_SUFFIX = ".encrypted";

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_SIZE, { N: 2 ** 14, r: 8, p: 1 });
}

export function encryptBuffer(plaintext: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_SIZE);
  const iv = crypto.randomBytes(IV_SIZE);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, encrypted]);
}

export function decryptBuffer(data: Buffer, password: string): Buffer {
  if (!isEncrypted(data)) {
    throw new Error("File is not encrypted (missing BDOT header).");
  }

  const minSize = HEADER_SIZE + SALT_SIZE + IV_SIZE + TAG_SIZE;
  if (data.length < minSize) {
    throw new Error("Encrypted file is too short or corrupted.");
  }

  let offset = HEADER_SIZE;
  const salt = data.subarray(offset, offset + SALT_SIZE);
  offset += SALT_SIZE;
  const iv = data.subarray(offset, offset + IV_SIZE);
  offset += IV_SIZE;
  const tag = data.subarray(offset, offset + TAG_SIZE);
  offset += TAG_SIZE;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed — wrong password or corrupted file.");
  }
}

function isEncrypted(data: Buffer): boolean {
  return (
    data.length >= HEADER_SIZE &&
    data[0] === MAGIC[0] &&
    data[1] === MAGIC[1] &&
    data[2] === MAGIC[2] &&
    data[3] === MAGIC[3] &&
    data[4] === VERSION
  );
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
  if (mode & 0o077) {
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

  const pw = await passwordPrompt({ message: "Enter encryption password:" });
  if (!pw) {
    throw new Error("No password provided.");
  }

  return { password: pw, interactive: true };
}

export async function confirmPassword(password: string): Promise<void> {
  const pw2 = await passwordPrompt({ message: "Confirm password:" });
  if (pw2 !== password) {
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

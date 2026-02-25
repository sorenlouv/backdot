import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./log.js";

const HOME = os.homedir();
export const STAGING_DIR = path.join(HOME, ".backdot", "repo");

export function copyToStaging(files: string[]): void {
  if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
  }

  let copied = 0;
  for (const filePath of files) {
    const rel = path.relative(HOME, filePath);

    const destRel = rel.startsWith("..") ? filePath.slice(1) : rel;
    const dest = path.join(STAGING_DIR, destRel);

    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(filePath, dest);
      copied++;
    } catch {
      logger.warn(`Failed to copy: ${filePath} -> ${dest}`);
    }
  }

  logger.info(`Copied ${copied} file(s) to staging`);
}

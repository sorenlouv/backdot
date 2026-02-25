import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./log.js";

const HOME = os.homedir();
export const STAGING_DIR = path.join(HOME, ".backdot", "repo");

export function machineDir(machine: string): string {
  return path.join(STAGING_DIR, machine);
}

export function cleanStaging(machine: string): void {
  const dir = machineDir(machine);
  if (!fs.existsSync(dir)) return;

  fs.rmSync(dir, { recursive: true, force: true });
  logger.info(`Cleaned staging directory for machine "${machine}"`);
}

export function copyToStaging(files: string[], machine: string): void {
  const dir = machineDir(machine);
  fs.mkdirSync(dir, { recursive: true });

  let copied = 0;
  for (const filePath of files) {
    const rel = path.relative(HOME, filePath);

    const destRel = rel.startsWith("..") ? filePath.slice(1) : rel;
    const dest = path.join(dir, destRel);

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

const REPO_README = `# Dotfiles Backup

This repository contains dotfiles backed up automatically using [backdot](https://github.com/sorenlouv/backdot).

## Quick start

Install backdot:

\`\`\`bash
npm install -g backdot
\`\`\`

Restore files from this backup:

\`\`\`bash
backdot --restore
\`\`\`

For full documentation, configuration options, and scheduling, see the [official README](https://github.com/sorenlouv/backdot).
`;

export function writeRepoReadme(): void {
  fs.writeFileSync(path.join(STAGING_DIR, "README.md"), REPO_README);
  logger.info("Wrote README.md to staging directory");
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { logger } from "./log.js";

const HOME = os.homedir();
export const STAGING_DIR = path.join(HOME, ".backdot", "repo");

export function machineDir(machine: string): string {
  return path.join(STAGING_DIR, machine);
}

export function getStagedPath(filePath: string, machine: string): string {
  const rel = path.relative(HOME, filePath);
  const destRel = rel.startsWith("..") ? filePath.slice(1) : rel;
  return path.join(machineDir(machine), destRel);
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
    const dest = getStagedPath(filePath, machine);

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

export interface ComparisonResult {
  backedUp: string[];
  modified: string[];
  notBackedUp: string[];
}

export async function compareFiles(
  files: string[],
  machine: string,
): Promise<ComparisonResult> {
  const result: ComparisonResult = { backedUp: [], modified: [], notBackedUp: [] };
  if (files.length === 0) return result;

  const gitDir = path.join(STAGING_DIR, ".git");
  if (!fs.existsSync(gitDir)) {
    result.notBackedUp.push(...files);
    return result;
  }

  const git = simpleGit(STAGING_DIR);
  await git.fetch("origin");

  let branch: string;
  try {
    branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  } catch {
    result.notBackedUp.push(...files);
    return result;
  }

  const committedHashes = new Map<string, string>();
  try {
    const treeOutput = execFileSync(
      "git",
      ["ls-tree", "-r", `origin/${branch}`, `${machine}/`],
      { encoding: "utf-8", cwd: STAGING_DIR },
    );
    for (const line of treeOutput.split("\n")) {
      if (!line) continue;
      const match = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
      if (match) {
        committedHashes.set(match[2], match[1]);
      }
    }
  } catch {
    result.notBackedUp.push(...files);
    return result;
  }

  let sourceHashes: string[];
  try {
    const hashOutput = execFileSync("git", ["hash-object", "--", ...files], {
      encoding: "utf-8",
    });
    sourceHashes = hashOutput.trim().split("\n");
  } catch {
    result.notBackedUp.push(...files);
    return result;
  }

  for (let i = 0; i < files.length; i++) {
    const repoRelPath = path.relative(STAGING_DIR, getStagedPath(files[i], machine));
    const committedHash = committedHashes.get(repoRelPath);
    const sourceHash = sourceHashes[i];

    if (!committedHash) {
      result.notBackedUp.push(files[i]);
    } else if (committedHash === sourceHash) {
      result.backedUp.push(files[i]);
    } else {
      result.modified.push(files[i]);
    }
  }

  return result;
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

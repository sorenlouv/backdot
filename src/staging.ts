import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { logger } from "./log.js";
import { errorMessage, pluralize } from "./utils.js";
import { ensureRemoteUrl, getCurrentBranch, gitError } from "./git.js";
import { STAGING_DIR, STAGING_GIT_DIR, machineDir } from "./paths.js";

export { STAGING_DIR, STAGING_GIT_DIR, machineDir };

const HOME = os.homedir();

export function getStagedPath(filePath: string, machine: string): string {
  const rel = path.relative(HOME, filePath);
  const destRel = rel.startsWith("..") ? filePath.slice(1) : rel;
  return path.join(machineDir(machine), destRel);
}

export function cleanStaging(machine: string): void {
  const dir = machineDir(machine);
  if (!fs.existsSync(dir)) {
    return;
  }

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

  logger.info(`Copied ${pluralize(copied, "file")} to staging`);
}

export interface ComparisonResult {
  backedUp: string[];
  modified: string[];
  notBackedUp: string[];
  error?: string;
}

function failedComparisonResult(err: unknown): ComparisonResult {
  return { backedUp: [], modified: [], notBackedUp: [], error: errorMessage(err) };
}

export async function compareFiles(
  files: string[],
  machine: string,
  repository: string,
): Promise<ComparisonResult> {
  if (files.length === 0) {
    return { backedUp: [], modified: [], notBackedUp: [] };
  }

  if (!fs.existsSync(STAGING_GIT_DIR)) {
    return failedComparisonResult(
      new Error("Backup repository not found. Run backdot --backup first."),
    );
  }

  const git = simpleGit(STAGING_DIR);

  try {
    await ensureRemoteUrl(repository);
    await git.fetch("origin");
  } catch (err) {
    return failedComparisonResult(gitError(err, repository));
  }

  let branch: string;
  try {
    branch = await getCurrentBranch(git);
  } catch (err) {
    return failedComparisonResult(err);
  }

  let committedHashes: Map<string, string>;
  try {
    const treeOutput = execFileSync("git", ["ls-tree", "-r", `origin/${branch}`, `${machine}/`], {
      encoding: "utf-8",
      cwd: STAGING_DIR,
    });
    committedHashes = new Map(
      treeOutput
        .split("\n")
        .map((line) => line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[2], m[1]] as const),
    );
  } catch (err) {
    return failedComparisonResult(err);
  }

  let sourceHashes: string[];
  try {
    const hashOutput = execFileSync("git", ["hash-object", "--stdin-paths"], {
      encoding: "utf-8",
      input: files.join("\n") + "\n",
    });
    sourceHashes = hashOutput.trim().split("\n");
  } catch (err) {
    return failedComparisonResult(err);
  }

  return files.reduce<ComparisonResult>(
    (acc, file, i) => {
      const repoRelPath = path.relative(STAGING_DIR, getStagedPath(file, machine));
      const committedHash = committedHashes.get(repoRelPath);

      if (!committedHash) {
        acc.notBackedUp.push(file);
      } else if (committedHash === sourceHashes[i]) {
        acc.backedUp.push(file);
      } else {
        acc.modified.push(file);
      }

      return acc;
    },
    { backedUp: [], modified: [], notBackedUp: [] },
  );
}

function repoReadme(repository: string): string {
  return `# Backdot Backup

This repository contains dotfiles backed up automatically using [backdot](https://github.com/sorenlouv/backdot).

## Restore

\`\`\`bash
npx backdot --restore ${repository}
\`\`\`

For full documentation, configuration options, and scheduling, see the [official README](https://github.com/sorenlouv/backdot).
`;
}

export function writeRepoReadme(repository: string): void {
  fs.writeFileSync(path.join(STAGING_DIR, "README.md"), repoReadme(repository));
  logger.info("Wrote README.md to staging directory");
}

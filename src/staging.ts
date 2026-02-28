import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { logger } from "./log.js";
import { errorMessage, pluralize } from "./utils.js";
import { ensureRemoteUrl, getCurrentBranch, gitError } from "./git.js";
import { STAGING_DIR, STAGING_GIT_DIR, machineDir } from "./paths.js";
import { encryptBuffer, decryptBuffer, KEY_FILE_PATH, ENC_SUFFIX } from "./crypto.js";

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

export function copyToStaging(files: string[], machine: string, password?: string): void {
  const dir = machineDir(machine);
  fs.mkdirSync(dir, { recursive: true });

  const filesExcludingKeyFile = files.filter(
    (f) => path.resolve(f) !== path.resolve(KEY_FILE_PATH),
  );

  let copied = 0;
  for (const filePath of filesExcludingKeyFile) {
    const dest = getStagedPath(filePath, machine);
    const finalDest = password ? dest + ENC_SUFFIX : dest;

    try {
      fs.mkdirSync(path.dirname(finalDest), { recursive: true });

      if (password) {
        const plaintext = fs.readFileSync(filePath);
        fs.writeFileSync(finalDest, encryptBuffer(plaintext, password));
      } else {
        fs.copyFileSync(filePath, finalDest);
      }
      copied++;
    } catch {
      logger.warn(`Failed to copy: ${filePath} -> ${finalDest}`);
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

export async function compareFiles(opts: {
  files: string[];
  machine: string;
  repository: string;
  password?: string;
}): Promise<ComparisonResult> {
  const { files, machine, repository, password } = opts;
  if (files.length === 0) {
    return { backedUp: [], modified: [], notBackedUp: [] };
  }

  if (!fs.existsSync(STAGING_GIT_DIR)) {
    return failedComparisonResult(
      new Error('Backup repository not found. Run "backdot backup" first.'),
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

  if (password) {
    return compareFilesEncrypted(files, machine, committedHashes, password);
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

function compareFilesEncrypted(
  files: string[],
  machine: string,
  committedHashes: Map<string, string>,
  password: string,
): ComparisonResult {
  const result: ComparisonResult = { backedUp: [], modified: [], notBackedUp: [] };

  for (const file of files) {
    const repoRelPath = path.relative(STAGING_DIR, getStagedPath(file, machine)) + ENC_SUFFIX;
    const blobHash = committedHashes.get(repoRelPath);

    if (!blobHash) {
      result.notBackedUp.push(file);
      continue;
    }

    try {
      const blobContent = execFileSync("git", ["cat-file", "blob", blobHash], {
        cwd: STAGING_DIR,
        maxBuffer: 50 * 1024 * 1024,
      });

      const decrypted = decryptBuffer(blobContent, password);
      const localContent = fs.readFileSync(file);

      if (decrypted.equals(localContent)) {
        result.backedUp.push(file);
      } else {
        result.modified.push(file);
      }
    } catch {
      result.modified.push(file);
    }
  }

  return result;
}

function repoReadme(repository: string, encrypted: boolean): string {
  const encryptionNote = encrypted
    ? "\n> **Note:** Files in this repository are encrypted. You will need the backup password to restore.\n"
    : "";

  return `# Backdot Backup

This repository contains files backed up automatically using [backdot](https://github.com/sorenlouv/backdot).
${encryptionNote}
## Restore

\`\`\`bash
npx backdot restore ${repository}
\`\`\`

For full documentation, configuration options, and scheduling, see the [official README](https://github.com/sorenlouv/backdot).
`;
}

export function writeRepoReadme(repository: string, encrypted = false): void {
  fs.writeFileSync(path.join(STAGING_DIR, "README.md"), repoReadme(repository, encrypted));
  logger.info("Wrote README.md to staging directory");
}

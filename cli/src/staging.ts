import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { logger } from "./log.js";
import { errorMessage, pluralize } from "./utils.js";
import { ensureRemoteUrl, getCurrentBranch, gitError } from "./git.js";
import { STAGING_DIR, STAGING_GIT_DIR, machineDir } from "./paths.js";
import { encrypt, decrypt, type DerivedKey } from "./crypto/encryption.js";
import { KEY_FILE_PATH, ENC_SUFFIX } from "./crypto/password.js";

export { STAGING_DIR, STAGING_GIT_DIR, machineDir };

const HOME = os.homedir();

// Backed-up files live under one of two namespaces inside the machine dir, which
// keeps the layout lossless: HOME files restore relative to the restoring machine's
// own home (portable across machines), while files elsewhere restore to their
// original absolute path.
export const HOME_NAMESPACE = "home";
export const ROOT_NAMESPACE = "root";

function isOutsideHome(filePath: string): boolean {
  const relativeToHome = path.relative(HOME, filePath);
  return relativeToHome.startsWith("..") || path.isAbsolute(relativeToHome);
}

export function getStagedPath(filePath: string, machine: string): string {
  const pathWithinMachineDir = isOutsideHome(filePath)
    ? path.join(ROOT_NAMESPACE, filePath.slice(1)) // strip leading "/" so it stays inside the machine dir
    : path.join(HOME_NAMESPACE, path.relative(HOME, filePath));
  return path.join(machineDir(machine), pathWithinMachineDir);
}

export interface RestoreTarget {
  /** Absolute path the file is restored to on this machine. */
  destination: string;
  /** Path shown in the restore picker (e.g. "~/.zshrc" or "/etc/hosts"). */
  displayPath: string;
}

/**
 * Inverse of getStagedPath: maps a path relative to the machine dir
 * (e.g. "home/.zshrc" or "root/etc/hosts") back to its restore destination.
 */
export function getRestoreTarget(machineRelativePath: string): RestoreTarget {
  const [namespace, ...rest] = machineRelativePath.split(path.sep);
  const subPath = rest.join(path.sep);

  if (namespace === ROOT_NAMESPACE) {
    const destination = path.join("/", subPath);
    return { destination, displayPath: destination };
  }
  return { destination: path.join(HOME, subPath), displayPath: path.join("~", subPath) };
}

export function cleanStaging(machine: string): void {
  // Remove only the backdot-managed namespaces so user-authored files in the
  // machine dir (e.g. a hand-written README.md with restore notes) survive
  // across backups. home/ and root/ are still fully rebuilt, so a backup
  // remains a complete snapshot of the configured files.
  for (const namespace of [HOME_NAMESPACE, ROOT_NAMESPACE]) {
    fs.rmSync(path.join(machineDir(machine), namespace), { recursive: true, force: true });
  }
  logger.info(`Cleaned staging namespaces for machine "${machine}"`);
}

export function copyToStaging(files: string[], machine: string, derivedKey?: DerivedKey): void {
  const machineStagingDir = machineDir(machine);
  fs.mkdirSync(machineStagingDir, { recursive: true });

  const filesExcludingKeyFile = files.filter(
    (f) => path.resolve(f) !== path.resolve(KEY_FILE_PATH),
  );

  let copiedCount = 0;
  for (const filePath of filesExcludingKeyFile) {
    const stagedPath = getStagedPath(filePath, machine);
    const destinationPath = derivedKey ? stagedPath + ENC_SUFFIX : stagedPath;

    try {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

      if (derivedKey) {
        const plaintext = fs.readFileSync(filePath);
        fs.writeFileSync(destinationPath, encrypt(plaintext, derivedKey));
      } else {
        fs.copyFileSync(filePath, destinationPath);
      }
      copiedCount++;
    } catch {
      logger.warn(`Failed to copy: ${filePath} -> ${destinationPath}`);
    }
  }

  logger.info(`Copied ${pluralize(copiedCount, "file")} to staging`);
}

export interface ComparisonResult {
  backedUp: string[];
  modified: string[];
  notBackedUp: string[];
  remoteIsEmpty?: boolean;
  error?: string;
}

function failedComparisonResult(err: unknown): ComparisonResult {
  return { backedUp: [], modified: [], notBackedUp: [], error: errorMessage(err) };
}

// This machine has no snapshot in the remote yet, so every file counts as "not
// backed up". Lets `status` preview what a first backup would push instead of erroring.
function emptyRemoteResult(files: string[]): ComparisonResult {
  return { backedUp: [], modified: [], notBackedUp: files, remoteIsEmpty: true };
}

export async function compareFiles(opts: {
  files: string[];
  machine: string;
  repository: string;
  resolveKey?: () => Promise<DerivedKey>;
}): Promise<ComparisonResult> {
  const { files, machine, repository, resolveKey } = opts;
  if (files.length === 0) {
    return { backedUp: [], modified: [], notBackedUp: [] };
  }

  if (!fs.existsSync(STAGING_GIT_DIR)) {
    return emptyRemoteResult(files);
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

  let remoteBlobHashes: Map<string, string>;
  try {
    const treeOutput = execFileSync("git", ["ls-tree", "-r", `origin/${branch}`, `${machine}/`], {
      encoding: "utf-8",
      cwd: STAGING_DIR,
    });
    remoteBlobHashes = new Map(
      treeOutput
        .split("\n")
        .map((line) => line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => [match[2], match[1]] as const),
    );
  } catch (err) {
    return failedComparisonResult(err);
  }

  // Repo reachable but this machine has nothing backed up yet (empty repo, or it
  // only holds other machines). Treat as a pre-backup preview.
  if (remoteBlobHashes.size === 0) {
    return emptyRemoteResult(files);
  }

  if (resolveKey) {
    const derivedKey = await resolveKey();
    return compareFilesToRemote(
      files,
      machine,
      remoteBlobHashes,
      ENC_SUFFIX,
      (file, remoteBlobHash) => {
        try {
          const blobContent = execFileSync("git", ["cat-file", "blob", remoteBlobHash], {
            cwd: STAGING_DIR,
            maxBuffer: 50 * 1024 * 1024,
          });
          const decrypted = decrypt(blobContent, derivedKey);
          const localContent = fs.readFileSync(file);
          return decrypted.equals(localContent);
        } catch {
          return false;
        }
      },
    );
  }

  let localFileHashes: string[];
  try {
    const hashOutput = execFileSync("git", ["hash-object", "--stdin-paths"], {
      encoding: "utf-8",
      input: files.join("\n") + "\n",
    });
    localFileHashes = hashOutput.trim().split("\n");
  } catch (err) {
    return failedComparisonResult(err);
  }

  const localHashByFile = new Map(files.map((file, i) => [file, localFileHashes[i]]));
  return compareFilesToRemote(files, machine, remoteBlobHashes, "", (file, remoteBlobHash) => {
    return remoteBlobHash === localHashByFile.get(file);
  });
}

function compareFilesToRemote(
  files: string[],
  machine: string,
  remoteBlobHashes: Map<string, string>,
  pathSuffix: string,
  matchesRemote: (file: string, remoteBlobHash: string) => boolean,
): ComparisonResult {
  const result: ComparisonResult = { backedUp: [], modified: [], notBackedUp: [] };

  for (const file of files) {
    const repoRelativePath = path.relative(STAGING_DIR, getStagedPath(file, machine)) + pathSuffix;
    const remoteBlobHash = remoteBlobHashes.get(repoRelativePath);

    if (!remoteBlobHash) {
      result.notBackedUp.push(file);
    } else if (matchesRemote(file, remoteBlobHash)) {
      result.backedUp.push(file);
    } else {
      result.modified.push(file);
    }
  }

  return result;
}

function generateReadmeContent(repository: string, encrypted: boolean): string {
  const encryptionNote = encrypted
    ? "\n> **Note:** Files in this repository are encrypted. You will need the backup password to restore.\n"
    : "";

  return `# Backdot Backup

This repository contains files backed up automatically using [backdot](https://github.com/sorenlouv/backdot).
${encryptionNote}
## Restore

\`\`\`bash
npx backdot restore ${repository} --machine <machine>
\`\`\`

Each machine is a top-level directory here; replace \`<machine>\` with the one you want to restore. A machine may also contain its own \`README.md\` with extra, machine-specific restore steps — backdot preserves it across backups.

For full documentation, configuration options, and scheduling, see the [official README](https://github.com/sorenlouv/backdot).
`;
}

export function writeRepoReadme(repository: string, encrypted = false): void {
  fs.writeFileSync(
    path.join(STAGING_DIR, "README.md"),
    generateReadmeContent(repository, encrypted),
  );
  logger.info("Wrote README.md to staging directory");
}

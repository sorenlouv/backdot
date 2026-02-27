import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const STAGING_DIR = path.join(HOME, ".backdot", "repo");
export const STAGING_GIT_DIR = path.join(STAGING_DIR, ".git");

export function machineDir(machine: string): string {
  return path.join(STAGING_DIR, machine);
}

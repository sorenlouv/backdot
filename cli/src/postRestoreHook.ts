import { execFileSync } from "node:child_process";
import os from "node:os";
import { logger } from "./log.js";
import { errorMessage } from "./utils.js";
import { POST_RESTORE_HOOK_PATH } from "./paths.js";

/**
 * Runs the restored `~/.backdot/post-restore` script (a POSIX `sh` script) so a
 * restored machine can provision itself. The caller decides when to invoke this
 * (only when the hook was actually among the restored files). A non-zero exit is
 * surfaced as an error — never swallowed — but files have already been restored.
 */
export function runPostRestoreHook(): void {
  if (process.platform === "win32") {
    console.log("  Post-restore hook found, but hooks are not supported on Windows. Skipping.\n");
    logger.warn("Post-restore hook skipped (not supported on Windows)");
    return;
  }

  console.log(`  Running post-restore hook (${POST_RESTORE_HOOK_PATH})…\n`);
  logger.info("Running post-restore hook");

  try {
    execFileSync("/bin/sh", [POST_RESTORE_HOOK_PATH], {
      cwd: os.homedir(),
      stdio: "inherit",
    });
  } catch (err) {
    logger.error(`Post-restore hook failed: ${errorMessage(err)}`);
    const exitCode = (err as { status?: number }).status;
    const exitNote = typeof exitCode === "number" ? ` (exit code ${exitCode})` : "";
    throw new Error(
      `Files were restored, but the post-restore hook failed${exitNote}.\n` +
        `  Fix ${POST_RESTORE_HOOK_PATH} and re-run, or run it manually.`,
      { cause: err },
    );
  }

  console.log();
  logger.info("Post-restore hook completed");
}

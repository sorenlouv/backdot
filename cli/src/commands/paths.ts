import {
  CONFIG_PATH,
  KEY_FILE_PATH,
  STAGING_DIR,
  LOG_DIR,
  CLI_LOG_PATH,
  LAUNCHD_LOG_PATH,
  UI_LOG_PATH,
} from "../paths.js";

export function printPaths(): void {
  const paths = {
    configFile: CONFIG_PATH,
    keyFile: KEY_FILE_PATH,
    stagingDir: STAGING_DIR,
    logDir: LOG_DIR,
    cliLog: CLI_LOG_PATH,
    launchdLog: LAUNCHD_LOG_PATH,
    uiLog: UI_LOG_PATH,
  };
  process.stdout.write(JSON.stringify(paths) + "\n");
}

import fs from "node:fs";
import { isScheduled } from "../launchd.js";
import { KEY_FILE_PATH } from "../paths.js";

export async function getScheduleAndEncryptionFileStatus(): Promise<void> {
  const scheduled = isScheduled();
  const passwordFileExists = fs.existsSync(KEY_FILE_PATH);
  const result = { scheduled, passwordFileExists };
  process.stdout.write(JSON.stringify(result) + "\n");
}

import fs from "node:fs";
import { KEY_FILE_PATH } from "../crypto/password.js";

export function removePasswordFile(): void {
  if (fs.existsSync(KEY_FILE_PATH)) {
    fs.unlinkSync(KEY_FILE_PATH);
  }
  process.stdout.write(JSON.stringify({ removed: true }) + "\n");
}

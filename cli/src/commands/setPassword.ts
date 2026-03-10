import { hashPassword, saveKeyFile } from "../crypto/password.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

export async function setPassword(): Promise<void> {
  const rawPassword = (await readStdin()).trimEnd();
  if (!rawPassword) {
    process.stdout.write(JSON.stringify({ error: "No password provided" }) + "\n");
    process.exitCode = 1;
    return;
  }

  const hashed = hashPassword(rawPassword);
  saveKeyFile(hashed);
  process.stdout.write(JSON.stringify({ saved: true }) + "\n");
}

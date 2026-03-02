import { execFile } from "node:child_process";
import { checkRepoVisibility } from "../repoVisibility.js";

type CheckRepoResult =
  | { status: "private" }
  | { status: "public" }
  | { status: "unknown" }
  | { status: "not_found"; message: string };

function authenticatedLsRemote(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["ls-remote", "--quiet", url],
      { timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin?.end();
  });
}

export async function checkRepo(url: string): Promise<void> {
  let result: CheckRepoResult;

  try {
    await authenticatedLsRemote(url);
  } catch {
    result = { status: "not_found", message: "Repository not found or not accessible" };
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  const visibility = await checkRepoVisibility(url);
  result = { status: visibility };
  process.stdout.write(JSON.stringify(result) + "\n");
}

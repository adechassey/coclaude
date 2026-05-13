import { execFileSync } from "node:child_process";
import os from "node:os";

export async function resolveHostName(): Promise<string> {
  try {
    const gitName = execFileSync("git", ["config", "user.name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitName) return gitName;
  } catch {
    // git not installed or no user.name configured; fall through
  }
  return os.userInfo().username || "host";
}

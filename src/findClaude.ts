import fs from "node:fs";
import path from "node:path";

/**
 * Locate the user's `claude` CLI binary on PATH. Used to bridge the
 * Bun-compiled binary case: `bun --compile` doesn't bundle the SDK's
 * platform-specific native binary (it's distributed via optional deps),
 * so we point the SDK at the user's installed `claude` instead.
 *
 * Returns null if not found; caller decides whether that's fatal.
 */
export function findClaudeExecutable(): string | null {
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter);
  const exts =
    process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, "claude" + ext);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // not present; keep looking
      }
    }
  }
  return null;
}

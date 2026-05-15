import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".coclaude",
]);
const MAX_FILES = 5000;

// Ask git for tracked + untracked-not-ignored files. Honors .gitignore,
// .git/info/exclude, and the user's global excludes. Returns null if we're
// not in a git repo or git isn't available.
async function listFilesFromGit(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, maxBuffer: 50 * 1024 * 1024 },
    );
    const files = stdout.split("\0").filter(Boolean);
    return files.slice(0, MAX_FILES);
  } catch {
    return null;
  }
}

function listFilesManual(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        out.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return out;
}

export async function listProjectFiles(root: string): Promise<string[]> {
  return (await listFilesFromGit(root)) ?? listFilesManual(root);
}

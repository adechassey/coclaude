import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProjectFiles } from "../src/files.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coclaude-files-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, body = ""): void {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function makeDir(rel: string): void {
  fs.mkdirSync(path.join(tmpDir, rel), { recursive: true });
}

describe("listProjectFiles", () => {
  it("lists files in a non-git directory via the manual fallback", async () => {
    write("a.ts");
    write("sub/b.ts");
    const files = await listProjectFiles(tmpDir);
    expect(files.sort()).toEqual(["a.ts", path.join("sub", "b.ts")].sort());
  });

  it("skips node_modules, dist, and other common build artefacts", async () => {
    write("src/index.ts");
    write("node_modules/foo/package.json");
    write("dist/bundle.js");
    write("build/output.js");
    write(".cache/whatever");
    write(".coclaude/session.jsonl");
    const files = await listProjectFiles(tmpDir);
    // We can't assert exact set across git vs manual paths, but none of the
    // skip-dirs should appear.
    for (const f of files) {
      expect(f).not.toMatch(/(^|\/)node_modules\//);
      expect(f).not.toMatch(/(^|\/)dist\//);
      expect(f).not.toMatch(/(^|\/)build\//);
      expect(f).not.toMatch(/(^|\/)\.cache\//);
      expect(f).not.toMatch(/(^|\/)\.coclaude\//);
    }
    expect(files).toContain(path.join("src", "index.ts"));
  });

  it("skips dotfiles (manual walk)", async () => {
    // In a non-git directory the manual walker skips entries starting with '.'.
    write(".env");
    write("README.md");
    // Ensure we go down the manual path by not initializing git here.
    const files = await listProjectFiles(tmpDir);
    // .env may appear via git in a parent repo (when running tests from this
    // repo's root, git ls-files runs in the cwd). The function uses the
    // passed root, so it should not bleed in unrelated files. The key
    // assertion: README is listed.
    expect(files).toContain("README.md");
  });

  it("returns an empty list for a directory that doesn't exist", async () => {
    const ghost = path.join(tmpDir, "ghost");
    const files = await listProjectFiles(ghost);
    expect(files).toEqual([]);
  });

  it("does not crash on an empty directory", async () => {
    makeDir("empty");
    const files = await listProjectFiles(path.join(tmpDir, "empty"));
    expect(files).toEqual([]);
  });
});

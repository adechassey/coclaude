import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findClaudeExecutable } from "../src/findClaude.js";

let tmpDir: string;
let originalPath: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coclaude-findclaude-"));
  originalPath = process.env["PATH"];
});

afterEach(() => {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("findClaudeExecutable", () => {
  it("finds a claude binary in PATH", () => {
    const binPath = path.join(tmpDir, "claude");
    fs.writeFileSync(binPath, "#!/bin/sh\necho claude\n", { mode: 0o755 });
    process.env["PATH"] = tmpDir;
    expect(findClaudeExecutable()).toBe(binPath);
  });

  it("returns null when no claude is on PATH", () => {
    process.env["PATH"] = tmpDir;
    expect(findClaudeExecutable()).toBeNull();
  });

  it("returns null with an empty PATH", () => {
    process.env["PATH"] = "";
    expect(findClaudeExecutable()).toBeNull();
  });

  it("skips empty PATH segments", () => {
    const binPath = path.join(tmpDir, "claude");
    fs.writeFileSync(binPath, "", { mode: 0o755 });
    process.env["PATH"] = `${path.delimiter}${tmpDir}${path.delimiter}`;
    expect(findClaudeExecutable()).toBe(binPath);
  });

  it("returns the first match when claude exists in multiple PATH dirs", () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "coclaude-findclaude-2-"));
    try {
      const first = path.join(tmpDir, "claude");
      const second = path.join(tmpDir2, "claude");
      fs.writeFileSync(first, "", { mode: 0o755 });
      fs.writeFileSync(second, "", { mode: 0o755 });
      process.env["PATH"] = `${tmpDir}${path.delimiter}${tmpDir2}`;
      expect(findClaudeExecutable()).toBe(first);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventLog } from "../../src/log/EventLog.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coclaude-eventlog-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function logPath(name = "test.jsonl"): string {
  return path.join(tmpDir, name);
}

describe("EventLog.defaultPath", () => {
  it("places sessions under ~/.coclaude/sessions/<id>.jsonl", () => {
    const p = EventLog.defaultPath("abc-123");
    expect(p.endsWith(path.join(".coclaude", "sessions", "abc-123.jsonl"))).toBe(true);
    expect(p.startsWith(os.homedir())).toBe(true);
  });
});

describe("EventLog.append", () => {
  it("assigns monotonic seq starting from initialNextSeq", async () => {
    const log = new EventLog("sid", logPath(), 10);
    const a = log.append({ type: "user_prompt", author: "alice", content: "hi" });
    const b = log.append({ type: "user_prompt", author: "alice", content: "ho" });
    expect(a.seq).toBe(10);
    expect(b.seq).toBe(11);
    await log.close();
  });

  it("stamps ts close to Date.now()", async () => {
    const before = Date.now();
    const log = new EventLog("sid", logPath());
    const ev = log.append({ type: "user_prompt", author: "a", content: "x" });
    const after = Date.now();
    expect(ev.ts).toBeGreaterThanOrEqual(before);
    expect(ev.ts).toBeLessThanOrEqual(after);
    await log.close();
  });

  it("creates the parent directory if missing", async () => {
    const nested = path.join(tmpDir, "deep", "nested", "path", "log.jsonl");
    const log = new EventLog("sid", nested);
    log.append({ type: "user_prompt", author: "a", content: "x" });
    await log.close();
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe("EventLog round-trip", () => {
  it("append events then readSync recovers them", async () => {
    const p = logPath();
    const log = new EventLog("sid", p);
    const e1 = log.append({ type: "user_prompt", author: "a", content: "one" });
    const e2 = log.append({ type: "assistant_message", content: "two" });
    await log.close();

    const read = EventLog.readSync(p);
    expect(read).toEqual([e1, e2]);
  });
});

describe("EventLog.readSync", () => {
  it("returns [] for a missing file", () => {
    expect(EventLog.readSync(logPath("does-not-exist.jsonl"))).toEqual([]);
  });

  it("returns [] for an empty file", () => {
    const p = logPath();
    fs.writeFileSync(p, "");
    expect(EventLog.readSync(p)).toEqual([]);
  });

  it("skips malformed lines and parses valid ones", () => {
    const p = logPath();
    fs.writeFileSync(
      p,
      [
        '{"type":"user_prompt","author":"a","content":"x","seq":0,"ts":1}',
        "not json",
        '{"type":"assistant_message","content":"y","seq":1,"ts":2}',
        "",
      ].join("\n"),
    );
    const read = EventLog.readSync(p);
    expect(read).toHaveLength(2);
    expect(read[0]).toMatchObject({ type: "user_prompt", seq: 0 });
    expect(read[1]).toMatchObject({ type: "assistant_message", seq: 1 });
  });
});

describe("EventLog.close", () => {
  it("is idempotent", async () => {
    const log = new EventLog("sid", logPath());
    await log.close();
    await log.close();
  });

  it("subsequent appends after close return the event but are not persisted", async () => {
    const p = logPath();
    const log = new EventLog("sid", p);
    log.append({ type: "user_prompt", author: "a", content: "x" });
    await log.close();
    const dropped = log.append({ type: "user_prompt", author: "a", content: "y" });
    expect(dropped.seq).toBe(1);
    const onDisk = EventLog.readSync(p);
    expect(onDisk).toHaveLength(1);
  });
});

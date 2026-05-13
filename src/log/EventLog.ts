import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CoEvent, CoEventInput } from "../types.js";

export class EventLog {
  private stream: fs.WriteStream;
  private nextSeq = 0;

  constructor(
    public readonly sessionId: string,
    public readonly logPath: string,
  ) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.stream = fs.createWriteStream(logPath, { flags: "a" });
  }

  static defaultPath(sessionId: string): string {
    return path.join(os.homedir(), ".coclaude", "sessions", `${sessionId}.jsonl`);
  }

  append(event: CoEventInput): CoEvent {
    const full = { ...event, seq: this.nextSeq++, ts: Date.now() } as CoEvent;
    this.stream.write(JSON.stringify(full) + "\n");
    return full;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(() => resolve()));
  }
}

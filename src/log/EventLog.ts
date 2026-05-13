import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CoEvent, CoEventInput } from "../types.js";

export class EventLog {
  private stream: fs.WriteStream;
  private nextSeq: number;
  private closed = false;

  constructor(
    public readonly sessionId: string,
    public readonly logPath: string,
    initialNextSeq = 0,
  ) {
    this.nextSeq = initialNextSeq;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.stream = fs.createWriteStream(logPath, { flags: "a" });
    // Don't crash the process if the stream errors during shutdown; emit()
    // already guards against writes after close, this is belt-and-suspenders.
    this.stream.on("error", () => {});
  }

  static defaultPath(sessionId: string): string {
    return path.join(os.homedir(), ".coclaude", "sessions", `${sessionId}.jsonl`);
  }

  /** Read all events from a JSONL session log on disk. Returns [] if the
   * file doesn't exist or can't be parsed. Used for --resume. */
  static readSync(logPath: string): CoEvent[] {
    let content: string;
    try {
      content = fs.readFileSync(logPath, "utf8");
    } catch {
      return [];
    }
    const out: CoEvent[] = [];
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as CoEvent);
      } catch {
        // skip malformed line
      }
    }
    return out;
  }

  append(event: CoEventInput): CoEvent {
    const full = { ...event, seq: this.nextSeq++, ts: Date.now() } as CoEvent;
    if (!this.closed) {
      this.stream.write(JSON.stringify(full) + "\n");
    }
    return full;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    return new Promise((resolve) => this.stream.end(() => resolve()));
  }
}

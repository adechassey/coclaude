import {
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { EventLog } from "../log/EventLog.js";
import type { CoEvent, CoEventInput } from "../types.js";

export interface SessionOptions {
  hostName: string;
  resumeSessionId?: string;
}

export type EventListener = (event: CoEvent) => void;

export class Session {
  readonly sessionId: string;
  readonly hostName: string;
  private readonly resumeSessionId: string | undefined;
  private readonly eventLog: EventLog;
  private listeners = new Set<EventListener>();
  private slashCommandsListeners = new Set<(commands: SlashCommand[]) => void>();
  private slashCommands: SlashCommand[] = [];

  private userQueue: SDKUserMessage[] = [];
  private waiter: ((msg: SDKUserMessage | null) => void) | null = null;
  private closed = false;

  private abortController = new AbortController();

  constructor(opts: SessionOptions) {
    this.hostName = opts.hostName;
    this.resumeSessionId = opts.resumeSessionId;
    this.sessionId = opts.resumeSessionId ?? randomUUID();
    this.eventLog = new EventLog(
      this.sessionId,
      EventLog.defaultPath(this.sessionId),
    );
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onSlashCommands(listener: (commands: SlashCommand[]) => void): () => void {
    this.slashCommandsListeners.add(listener);
    if (this.slashCommands.length > 0) listener(this.slashCommands);
    return () => {
      this.slashCommandsListeners.delete(listener);
    };
  }

  getSlashCommands(): SlashCommand[] {
    return this.slashCommands;
  }

  private setSlashCommands(commands: SlashCommand[]): void {
    this.slashCommands = commands;
    for (const l of this.slashCommandsListeners) l(commands);
  }

  private emit(event: CoEventInput): void {
    const full = this.eventLog.append(event);
    for (const l of this.listeners) l(full);
  }

  submitPrompt(content: string, author: string = this.hostName): void {
    if (this.closed) return;
    this.emit({ type: "user_prompt", author, content });

    const tagged = `[${author}] ${content}`;
    const userMessage: SDKUserMessage = {
      type: "user",
      session_id: this.sessionId,
      message: { role: "user", content: tagged },
      parent_tool_use_id: null,
    } as SDKUserMessage;

    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(userMessage);
    } else {
      this.userQueue.push(userMessage);
    }
  }

  private async *userStream(): AsyncIterable<SDKUserMessage> {
    while (!this.closed) {
      let msg: SDKUserMessage | null;
      if (this.userQueue.length > 0) {
        msg = this.userQueue.shift()!;
      } else {
        msg = await new Promise<SDKUserMessage | null>((resolve) => {
          this.waiter = resolve;
        });
      }
      if (msg === null) return;
      yield msg;
    }
  }

  async run(): Promise<void> {
    const q = query({
      prompt: this.userStream(),
      options: {
        abortController: this.abortController,
        ...(this.resumeSessionId ? { resume: this.resumeSessionId } : {}),
      },
    });

    // Eagerly fetch the structured command list (name + description + argument
    // hints). Resolves once the SDK has initialized; we dispatch to listeners.
    q.supportedCommands()
      .then((commands) => {
        this.setSlashCommands(commands);
      })
      .catch((err: unknown) => {
        this.emit({
          type: "system",
          subtype: "supported_commands_error",
          payload: { message: (err as Error)?.message ?? String(err) },
        });
      });

    try {
      for await (const message of q) {
        this.handleSdkMessage(message);
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "AbortError") {
        this.emit({ type: "system", subtype: "aborted" });
      } else {
        this.emit({
          type: "system",
          subtype: "error",
          payload: { message: e?.message ?? String(err) },
        });
        throw err;
      }
    }
  }

  private handleSdkMessage(msg: SDKMessage): void {
    if (msg.type === "assistant") {
      const m = (msg as unknown as { message: { content: unknown } }).message;
      const text = extractText(m.content);
      if (text) this.emit({ type: "assistant_message", content: text });
      for (const t of extractToolUses(m.content)) {
        this.emit({
          type: "tool_call",
          toolName: t.name,
          toolUseId: t.id,
          input: t.input,
          author: this.hostName,
        });
      }
      return;
    }
    if (msg.type === "user") {
      // Tool results come back as user messages with tool_result content blocks.
      const m = (msg as unknown as { message: { content: unknown } }).message;
      for (const tr of extractToolResults(m.content)) {
        this.emit({
          type: "tool_result",
          toolUseId: tr.tool_use_id,
          content: tr.content,
          ...(tr.is_error ? { isError: true } : {}),
        });
      }
      return;
    }
    if (msg.type === "result") {
      const r = msg as unknown as {
        subtype: string;
        duration_ms: number;
        total_cost_usd: number;
        num_turns: number;
      };
      this.emit({
        type: "result",
        subtype: r.subtype,
        durationMs: r.duration_ms,
        totalCostUsd: r.total_cost_usd,
        numTurns: r.num_turns,
      });
      return;
    }
    // Everything else (init, partial, progress, hooks, status, etc.) is opaque
    // for v1 — log it so it shows up in ~/.coclaude/sessions/<id>.jsonl for
    // debugging, but don't surface in the conversation pane.
    const sys = msg as { type: string; subtype?: string };
    this.emit({
      type: "system",
      subtype: sys.subtype ?? msg.type,
      payload: msg,
    });
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
    this.abortController.abort();
    await this.eventLog.close();
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
}

function extractToolUses(
  content: unknown,
): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: { type?: string }) => b?.type === "tool_use")
    .map((b: { id: string; name: string; input: unknown }) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));
}

function extractToolResults(
  content: unknown,
): Array<{ tool_use_id: string; content: unknown; is_error?: boolean }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: { type?: string }) => b?.type === "tool_result")
    .map(
      (b: { tool_use_id: string; content: unknown; is_error?: boolean }) => ({
        tool_use_id: b.tool_use_id,
        content: b.content,
        ...(b.is_error !== undefined ? { is_error: b.is_error } : {}),
      }),
    );
}

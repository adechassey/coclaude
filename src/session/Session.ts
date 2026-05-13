import {
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { EventLog } from "../log/EventLog.js";
import type { CoEvent, CoEventInput } from "../types.js";
import type { Participant } from "../wire/protocol.js";
import type { JoinRequest, SessionView } from "./SessionView.js";

export interface SessionOptions {
  hostName: string;
  resumeSessionId?: string;
}

export type EventListener = (event: CoEvent) => void;

export class Session implements SessionView {
  readonly sessionId: string;
  readonly hostName: string;
  readonly isHost = true;
  get myName(): string {
    return this.hostName;
  }

  private readonly resumeSessionId: string | undefined;
  private readonly eventLog: EventLog;

  private events: CoEvent[] = [];
  private listeners = new Set<EventListener>();

  private slashCommands: SlashCommand[] = [];
  private slashCommandsListeners = new Set<(commands: SlashCommand[]) => void>();

  private participants: Participant[] = [];
  private participantsListeners = new Set<(p: Participant[]) => void>();

  private joinRequestListeners = new Set<(req: JoinRequest) => void>();

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

  // SessionView ----------------------------------------------------------

  on(listener: EventListener): () => void {
    // Replay past events synchronously so late subscribers don't miss anything.
    for (const e of this.events) listener(e);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onFuture(listener: EventListener): () => void {
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

  onParticipants(listener: (p: Participant[]) => void): () => void {
    this.participantsListeners.add(listener);
    listener(this.participants);
    return () => {
      this.participantsListeners.delete(listener);
    };
  }

  onJoinRequest(listener: (req: JoinRequest) => void): () => void {
    this.joinRequestListeners.add(listener);
    return () => {
      this.joinRequestListeners.delete(listener);
    };
  }

  getEvents(): CoEvent[] {
    return this.events;
  }

  getSlashCommands(): SlashCommand[] {
    return this.slashCommands;
  }

  getParticipants(): Participant[] {
    return this.participants;
  }

  // Host-only API used by the WS gateway --------------------------------

  /** Called by the WS gateway when a connection passes the token check. */
  publishJoinRequest(req: JoinRequest): void {
    for (const l of this.joinRequestListeners) l(req);
  }

  addParticipant(name: string): void {
    if (this.participants.some((p) => p.name === name)) return;
    this.participants = [...this.participants, { name, connectedAt: Date.now() }];
    for (const l of this.participantsListeners) l(this.participants);
  }

  removeParticipant(name: string): void {
    const before = this.participants.length;
    this.participants = this.participants.filter((p) => p.name !== name);
    if (this.participants.length !== before) {
      for (const l of this.participantsListeners) l(this.participants);
    }
  }

  // Prompt submission ---------------------------------------------------

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

  // SDK loop ------------------------------------------------------------

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
    const sys = msg as { type: string; subtype?: string };
    this.emit({
      type: "system",
      subtype: sys.subtype ?? msg.type,
      payload: msg,
    });
  }

  private emit(event: CoEventInput): void {
    const full = this.eventLog.append(event);
    this.events.push(full);
    for (const l of this.listeners) l(full);
  }

  private setSlashCommands(commands: SlashCommand[]): void {
    this.slashCommands = commands;
    for (const l of this.slashCommandsListeners) l(commands);
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

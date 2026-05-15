import {
  query,
  type CanUseTool,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";

import { randomUUID } from "node:crypto";
import { translate } from "../sdk/translate.js";
import { EventLog } from "../log/EventLog.js";
import { findClaudeExecutable } from "../findClaude.js";
import { listProjectFiles } from "../files.js";
import type { CoEvent, CoEventInput } from "../types.js";
import type { Participant } from "../wire/protocol.js";
import type {
  JoinRequest,
  PendingApproval,
  SessionView,
  ToolApprovalDecision,
} from "./SessionView.js";
import { parseScope } from "../policy/scopes.js";
import {
  COCLAUDE_COMMAND_NAMES,
  COCLAUDE_COMMANDS,
} from "../policy/slashCommands.js";
import { Authorizer } from "../policy/Authorizer.js";
import { Topic } from "../util/Topic.js";
import { Stream } from "../util/Stream.js";

export interface SessionOptions {
  hostName: string;
  resumeSessionId?: string;
}

export type EventListener = (event: CoEvent) => void;

interface QueuedPrompt {
  msg: SDKUserMessage;
  author: string;
}

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

  private readonly slashCommandsTopic = new Topic<SlashCommand[]>(
    COCLAUDE_COMMANDS,
  );
  private readonly participantsTopic = new Topic<Participant[]>([]);
  private readonly queueDepthTopic = new Topic<number>(0);

  // Transient streaming state — not persisted to disk or events array.
  private readonly streamingTextTopic = new Topic<string>("");
  private readonly toolProgressStream = new Stream<{
    toolUseId: string;
    toolName: string;
    elapsedSec: number;
  }>();

  // Ring buffer cap. Older events live on disk only.
  private static readonly RING_BUFFER_SIZE = 500;

  private readonly authorizer: Authorizer;

  private readonly joinRequestStream = new Stream<JoinRequest>();
  private readonly kickStream = new Stream<string>();

  private userQueue: QueuedPrompt[] = [];
  private waiter: ((entry: QueuedPrompt | null) => void) | null = null;
  private closed = false;
  private currentAuthor: string;
  private abortController = new AbortController();

  // Interrupt state. interrupt() sets these and aborts the current
  // controller. Session.run()'s loop sees the flag and emits the marker
  // before starting the next query with `resume`.
  private interruptRequested = false;
  private interruptBy: string | null = null;
  private interruptReason: string | undefined;

  // Coclaude's sessionId is passed to the SDK as `sessionId` on the first
  // query and as `resume` on subsequent (post-interrupt) queries. Tracking
  // this flag avoids the SDK error of passing both.
  private firstQuery = true;
  private commandsFetched = false;

  constructor(opts: SessionOptions) {
    this.hostName = opts.hostName;
    this.currentAuthor = opts.hostName;
    this.resumeSessionId = opts.resumeSessionId;
    this.sessionId = opts.resumeSessionId ?? randomUUID();
    this.authorizer = new Authorizer({
      hostName: opts.hostName,
      emit: (e) => this.emit(e),
    });
    const logPath = EventLog.defaultPath(this.sessionId);

    let initialNextSeq = 0;
    if (opts.resumeSessionId) {
      const past = EventLog.readSync(logPath);
      // Keep only the last RING_BUFFER_SIZE in memory; older events are
      // recoverable from disk but won't be replayed to subscribers.
      this.events =
        past.length > Session.RING_BUFFER_SIZE
          ? past.slice(-Session.RING_BUFFER_SIZE)
          : past;
      if (past.length > 0) {
        initialNextSeq = past[past.length - 1]!.seq + 1;
      }
    }

    this.eventLog = new EventLog(this.sessionId, logPath, initialNextSeq);
  }

  // SessionView ----------------------------------------------------------

  on(listener: EventListener): () => void {
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
    return this.slashCommandsTopic.on(listener);
  }

  onParticipants(listener: (p: Participant[]) => void): () => void {
    return this.participantsTopic.on(listener);
  }

  onQueueChange(listener: (depth: number) => void): () => void {
    return this.queueDepthTopic.on(listener);
  }

  private notifyQueue(): void {
    this.queueDepthTopic.set(this.userQueue.length);
  }

  onStream(listener: (text: string) => void): () => void {
    return this.streamingTextTopic.on(listener);
  }

  onToolProgress(
    listener: (p: {
      toolUseId: string;
      toolName: string;
      elapsedSec: number;
    }) => void,
  ): () => void {
    return this.toolProgressStream.on(listener);
  }

  getStreamingText(): string {
    return this.streamingTextTopic.value;
  }

  private setStreaming(text: string): void {
    this.streamingTextTopic.set(text);
  }

  private notifyToolProgress(p: {
    toolUseId: string;
    toolName: string;
    elapsedSec: number;
  }): void {
    this.toolProgressStream.emit(p);
  }

  onJoinRequest(listener: (req: JoinRequest) => void): () => void {
    return this.joinRequestStream.on(listener);
  }

  onToolApproval(listener: (req: PendingApproval) => void): () => void {
    return this.authorizer.onApprovalRequest(listener);
  }

  onToolApprovalResolved(listener: (id: string) => void): () => void {
    return this.authorizer.onApprovalResolved(listener);
  }

  resolveToolApproval(id: string, decision: ToolApprovalDecision): void {
    this.authorizer.resolveApproval(id, decision);
  }

  getEvents(): CoEvent[] {
    return this.events;
  }

  getSlashCommands(): SlashCommand[] {
    return this.slashCommandsTopic.value;
  }

  getParticipants(): Participant[] {
    return this.participantsTopic.value;
  }

  async listFiles(): Promise<string[]> {
    return listProjectFiles(process.cwd());
  }

  // Host-only API used by the WS gateway --------------------------------

  publishJoinRequest(req: JoinRequest): void {
    this.joinRequestStream.emit(req);
  }

  addParticipant(name: string): void {
    const current = this.participantsTopic.value;
    if (current.some((p) => p.name === name)) return;
    this.authorizer.initParticipant(name);
    this.participantsTopic.set([
      ...current,
      { name, connectedAt: Date.now() },
    ]);
  }

  removeParticipant(name: string): void {
    const current = this.participantsTopic.value;
    const next = current.filter((p) => p.name !== name);
    this.authorizer.forgetParticipant(name);
    if (next.length !== current.length) {
      this.participantsTopic.set(next);
    }
  }

  getScope(name: string): import("../policy/scopes.js").Scope {
    return this.authorizer.getScope(name);
  }

  onKick(listener: (name: string) => void): () => void {
    return this.kickStream.on(listener);
  }

  // Prompt submission ---------------------------------------------------

  submitPrompt(content: string, author: string = this.hostName): void {
    if (this.closed) return;
    const trimmed = content.trim();
    if (!trimmed) return;

    // Intercept coclaude commands before they reach the SDK.
    if (trimmed.startsWith("/")) {
      const head = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
      if (COCLAUDE_COMMAND_NAMES.has(head)) {
        this.handleCoclaudeCommand(trimmed, author);
        return;
      }
    }

    this.emit({ type: "user_prompt", author, content: trimmed });

    const tagged = `[${author}] ${trimmed}`;
    const userMessage: SDKUserMessage = {
      type: "user",
      session_id: this.sessionId,
      message: { role: "user", content: tagged },
      parent_tool_use_id: null,
    } as SDKUserMessage;

    const entry: QueuedPrompt = { msg: userMessage, author };
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(entry);
    } else {
      this.userQueue.push(entry);
      this.notifyQueue();
    }
  }

  // Coclaude commands ---------------------------------------------------

  private handleCoclaudeCommand(content: string, author: string): void {
    const tokens = content.slice(1).split(/\s+/);
    const cmd = tokens[0]?.toLowerCase() ?? "";
    const args = tokens.slice(1);

    // /who is readable for anyone; the rest are host-only.
    if (cmd !== "who" && author !== this.hostName) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: { command: cmd, message: `/${cmd} is host-only`, author },
      });
      return;
    }

    switch (cmd) {
      case "grant":
        this.cmdGrant(args, author);
        return;
      case "revoke":
        this.cmdRevoke(args, author);
        return;
      case "kick":
        this.cmdKick(args, author);
        return;
      case "who":
        this.cmdWho(author);
        return;
    }
  }

  private cmdGrant(args: string[], author: string): void {
    const [name, scopeArg] = args;
    if (!name || !scopeArg) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: { command: "grant", message: "usage: /grant <name> <scope>" },
      });
      return;
    }
    const scope = parseScope(scopeArg);
    if (!scope) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: {
          command: "grant",
          message: `unknown scope '${scopeArg}' (use readonly|edits|bash|unrestricted)`,
        },
      });
      return;
    }
    const result = this.authorizer.grant({
      name,
      scope,
      by: author,
      participantExists: this.participantsTopic.value.some(
        (p) => p.name === name,
      ),
    });
    if (!result.ok) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: { command: "grant", message: result.reason },
      });
    }
  }

  private cmdRevoke(args: string[], author: string): void {
    const [name] = args;
    if (!name) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: { command: "revoke", message: "usage: /revoke <name>" },
      });
      return;
    }
    const result = this.authorizer.revoke({
      name,
      by: author,
      participantExists: this.participantsTopic.value.some(
        (p) => p.name === name,
      ),
    });
    if (!result.ok) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: { command: "revoke", message: result.reason },
      });
    }
  }

  private cmdKick(args: string[], author: string): void {
    const [name] = args;
    if (!name) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: { command: "kick", message: "usage: /kick <name>" },
      });
      return;
    }
    if (!this.participantsTopic.value.some((p) => p.name === name)) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: {
          command: "kick",
          message: `no participant named '${name}'`,
        },
      });
      return;
    }
    this.kickStream.emit(name);
    this.emit({
      type: "system",
      subtype: "kicked",
      payload: { name, by: author },
    });
  }

  private cmdWho(_author: string): void {
    const rows = [
      { name: this.hostName, scope: "host" as const },
      ...this.participantsTopic.value.map((p) => ({
        name: p.name,
        scope: this.authorizer.getScope(p.name),
      })),
    ];
    this.emit({
      type: "system",
      subtype: "who",
      payload: { rows },
    });
  }

  // SDK loop ------------------------------------------------------------

  private async *userStream(): AsyncIterable<SDKUserMessage> {
    while (!this.closed) {
      let entry: QueuedPrompt | null;
      if (this.userQueue.length > 0) {
        entry = this.userQueue.shift()!;
        this.notifyQueue();
      } else {
        entry = await new Promise<QueuedPrompt | null>((resolve) => {
          this.waiter = resolve;
        });
      }
      if (entry === null) return;
      this.currentAuthor = entry.author;
      yield entry.msg;
    }
  }

  async run(): Promise<void> {
    const canUseTool: CanUseTool = (toolName, input, options) =>
      this.canUseTool(toolName, input, options);

    // Loop so interrupt-and-resume keeps the conversation going across
    // multiple SDK queries within one coclaude session.
    while (!this.closed) {
      this.abortController = new AbortController();

      // First query uses sessionId to claim our UUID; subsequent queries
      // resume it (post-interrupt). If the user passed --resume, treat it
      // the same as a post-interrupt resume.
      const useResume = !this.firstQuery || !!this.resumeSessionId;
      // `bun --compile` doesn't bundle the SDK's platform-specific native
      // binary, so for compiled-binary distributions we point the SDK at
      // the user's installed `claude` CLI instead. When this returns null
      // (no claude on PATH), the SDK falls back to its bundled binary,
      // which works for `pnpm dev` and fails loudly otherwise.
      const claudePath = findClaudeExecutable();
      const q = query({
        prompt: this.userStream(),
        options: {
          abortController: this.abortController,
          canUseTool,
          includePartialMessages: true,
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
          ...(useResume ? { resume: this.sessionId } : { sessionId: this.sessionId }),
        },
      });
      this.firstQuery = false;

      if (!this.commandsFetched) {
        this.commandsFetched = true;
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
      }

      let wasInterrupted = false;
      try {
        for await (const message of q) {
          this.handleSdkMessage(message);
        }
      } catch (err: unknown) {
        if (this.closed) return;
        if (this.interruptRequested) {
          wasInterrupted = true;
        } else {
          const e = err as { name?: string; message?: string };
          this.emit({
            type: "system",
            subtype: "error",
            payload: { message: e?.message ?? String(err) },
          });
          throw err;
        }
      }

      if (wasInterrupted) {
        this.emit({
          type: "interrupted",
          by: this.interruptBy ?? "?",
          ...(this.interruptReason !== undefined
            ? { reason: this.interruptReason }
            : {}),
        });
        this.interruptRequested = false;
        this.interruptBy = null;
        this.interruptReason = undefined;
        continue;
      }

      // Normal completion — userStream returned because we're closing.
      break;
    }
  }

  interrupt(by: string = this.hostName, reason?: string): void {
    if (this.closed) return;
    this.interruptRequested = true;
    this.interruptBy = by;
    this.interruptReason = reason;
    this.abortController.abort();
  }

  getQueueDepth(): number {
    return this.userQueue.length;
  }

  private canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string },
  ): Promise<PermissionResult> {
    return this.authorizer.decide({
      author: this.currentAuthor,
      toolName,
      input,
      toolUseId: options.toolUseID,
      signal: options.signal,
    });
  }

  private handleSdkMessage(msg: SDKMessage): void {
    const { events, streamingDelta, toolProgress } = translate(
      msg,
      this.currentAuthor,
    );
    for (const e of events) this.emit(e);
    if (streamingDelta?.kind === "reset") {
      this.setStreaming("");
    } else if (streamingDelta?.kind === "append") {
      this.setStreaming(this.streamingTextTopic.value + streamingDelta.text);
    }
    if (toolProgress) this.notifyToolProgress(toolProgress);
  }

  private emit(event: CoEventInput): void {
    if (this.closed) return;
    const full = this.eventLog.append(event);
    this.events.push(full);
    if (this.events.length > Session.RING_BUFFER_SIZE) {
      this.events.splice(0, this.events.length - Session.RING_BUFFER_SIZE);
    }
    for (const l of this.listeners) l(full);
  }

  private setSlashCommands(commands: SlashCommand[]): void {
    // Coclaude's commands always appear first in the picker.
    this.slashCommandsTopic.set([...COCLAUDE_COMMANDS, ...commands]);
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

import {
  query,
  type CanUseTool,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { EventLog } from "../log/EventLog.js";
import type { CoEvent, CoEventInput } from "../types.js";
import type { Participant } from "../wire/protocol.js";
import type {
  JoinRequest,
  SessionView,
  ToolApprovalDecision,
  ToolApprovalRequest,
} from "./SessionView.js";
import {
  DEFAULT_SCOPE,
  isInScope,
  parseScope,
  type Scope,
} from "../policy/scopes.js";
import {
  COCLAUDE_COMMAND_NAMES,
  COCLAUDE_COMMANDS,
} from "../policy/slashCommands.js";

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

  private slashCommands: SlashCommand[] = COCLAUDE_COMMANDS;
  private slashCommandsListeners = new Set<(commands: SlashCommand[]) => void>();

  private participants: Participant[] = [];
  private participantsListeners = new Set<(p: Participant[]) => void>();

  private scopes = new Map<string, Scope>();

  private joinRequestListeners = new Set<(req: JoinRequest) => void>();
  private toolApprovalListeners = new Set<(req: ToolApprovalRequest) => void>();
  private kickListeners = new Set<(name: string) => void>();

  private userQueue: QueuedPrompt[] = [];
  private waiter: ((entry: QueuedPrompt | null) => void) | null = null;
  private closed = false;
  private currentAuthor: string;
  private abortController = new AbortController();

  constructor(opts: SessionOptions) {
    this.hostName = opts.hostName;
    this.currentAuthor = opts.hostName;
    this.resumeSessionId = opts.resumeSessionId;
    this.sessionId = opts.resumeSessionId ?? randomUUID();
    this.eventLog = new EventLog(
      this.sessionId,
      EventLog.defaultPath(this.sessionId),
    );
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

  onToolApproval(listener: (req: ToolApprovalRequest) => void): () => void {
    this.toolApprovalListeners.add(listener);
    return () => {
      this.toolApprovalListeners.delete(listener);
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

  publishJoinRequest(req: JoinRequest): void {
    for (const l of this.joinRequestListeners) l(req);
  }

  addParticipant(name: string): void {
    if (this.participants.some((p) => p.name === name)) return;
    this.participants = [
      ...this.participants,
      { name, connectedAt: Date.now() },
    ];
    if (!this.scopes.has(name)) this.scopes.set(name, DEFAULT_SCOPE);
    for (const l of this.participantsListeners) l(this.participants);
  }

  removeParticipant(name: string): void {
    const before = this.participants.length;
    this.participants = this.participants.filter((p) => p.name !== name);
    this.scopes.delete(name);
    if (this.participants.length !== before) {
      for (const l of this.participantsListeners) l(this.participants);
    }
  }

  getScope(name: string): Scope {
    if (name === this.hostName) return "unrestricted";
    return this.scopes.get(name) ?? DEFAULT_SCOPE;
  }

  onKick(listener: (name: string) => void): () => void {
    this.kickListeners.add(listener);
    return () => {
      this.kickListeners.delete(listener);
    };
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
    if (!this.participants.some((p) => p.name === name)) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: {
          command: "grant",
          message: `no participant named '${name}'`,
        },
      });
      return;
    }
    this.scopes.set(name, scope);
    this.emit({
      type: "system",
      subtype: "scope_changed",
      payload: { name, scope, by: author },
    });
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
    if (!this.participants.some((p) => p.name === name)) {
      this.emit({
        type: "system",
        subtype: "command_error",
        payload: {
          command: "revoke",
          message: `no participant named '${name}'`,
        },
      });
      return;
    }
    this.scopes.set(name, DEFAULT_SCOPE);
    this.emit({
      type: "system",
      subtype: "scope_changed",
      payload: { name, scope: DEFAULT_SCOPE, by: author },
    });
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
    if (!this.participants.some((p) => p.name === name)) {
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
    for (const l of this.kickListeners) l(name);
    this.emit({
      type: "system",
      subtype: "kicked",
      payload: { name, by: author },
    });
  }

  private cmdWho(_author: string): void {
    const rows = [
      { name: this.hostName, scope: "host" as const },
      ...this.participants.map((p) => ({
        name: p.name,
        scope: this.scopes.get(p.name) ?? DEFAULT_SCOPE,
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

    const q = query({
      prompt: this.userStream(),
      options: {
        abortController: this.abortController,
        canUseTool,
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
      if (this.closed) return;
      const e = err as { name?: string; message?: string };
      this.emit({
        type: "system",
        subtype: "error",
        payload: { message: e?.message ?? String(err) },
      });
      throw err;
    }
  }

  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string },
  ): Promise<PermissionResult> {
    const author = this.currentAuthor;
    if (author === this.hostName) {
      // Host's own turns bypass — governed by their settings.json.
      return { behavior: "allow", updatedInput: input };
    }
    const scope = this.getScope(author);
    if (isInScope(toolName, scope)) {
      this.emit({
        type: "system",
        subtype: "tool_auto_approved",
        payload: { author, toolName, scope, toolUseId: options.toolUseID },
      });
      return { behavior: "allow", updatedInput: input };
    }

    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      let settled = false;
      const settle = (d: ToolApprovalDecision) => {
        if (settled) return;
        settled = true;
        resolve(d);
      };
      const req: ToolApprovalRequest = {
        id: randomUUID(),
        author,
        toolName,
        input,
        currentScope: scope,
        resolve: settle,
      };
      for (const l of this.toolApprovalListeners) l(req);
      // Auto-deny after 60s if the host doesn't decide.
      const timer = setTimeout(
        () => settle({ decision: "deny", reason: "approval timed out (60s)" }),
        60_000,
      );
      options.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        settle({ decision: "deny", reason: "aborted" });
      });
    });

    if (decision.promoteScope) {
      this.scopes.set(author, decision.promoteScope);
      this.emit({
        type: "system",
        subtype: "scope_changed",
        payload: {
          name: author,
          scope: decision.promoteScope,
          by: this.hostName,
        },
      });
    }

    this.emit({
      type: "system",
      subtype:
        decision.decision === "approve" ? "tool_approved" : "tool_denied",
      payload: {
        author,
        toolName,
        toolUseId: options.toolUseID,
        reason: decision.reason,
      },
    });

    if (decision.decision === "approve") {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: decision.reason ?? "denied by host",
    };
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
          author: this.currentAuthor,
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
    if (this.closed) return;
    const full = this.eventLog.append(event);
    this.events.push(full);
    for (const l of this.listeners) l(full);
  }

  private setSlashCommands(commands: SlashCommand[]): void {
    // Coclaude's commands always appear first in the picker.
    this.slashCommands = [...COCLAUDE_COMMANDS, ...commands];
    for (const l of this.slashCommandsListeners) l(this.slashCommands);
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

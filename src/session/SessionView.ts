import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { CoEvent } from "../types.js";
import type { Participant } from "../wire/protocol.js";
import type { Scope } from "../policy/scopes.js";

export interface JoinRequest {
  id: string;
  name: string;
  remoteAddress: string;
  resolve(decision: "approve" | "deny", reason?: string): void;
}

// A serializable record of an in-flight tool-call approval request — no
// resolver function attached, so the same shape crosses both in-process and
// (future) wire boundaries. Subscribers resolve by id via
// SessionView.resolveToolApproval.
export interface PendingApproval {
  id: string;
  author: string;
  toolName: string;
  input: unknown;
  currentScope: Scope;
}

export interface ToolApprovalDecision {
  decision: "approve" | "deny";
  reason?: string;
  promoteScope?: Scope;
}

// Everything App needs to render a session, whether the underlying state lives
// in-process (host) or on the other end of a WebSocket (joiner).
export interface SessionView {
  readonly sessionId: string;
  readonly hostName: string;
  readonly myName: string;
  readonly isHost: boolean;

  /** Subscribe with replay of all past events synchronously, then live updates. */
  on(listener: (event: CoEvent) => void): () => void;
  /** Subscribe to events from now on — no replay. Use this when the caller
   * already has the past events from another channel (e.g. a welcome snapshot). */
  onFuture(listener: (event: CoEvent) => void): () => void;
  onSlashCommands(listener: (commands: SlashCommand[]) => void): () => void;
  onParticipants(listener: (participants: Participant[]) => void): () => void;
  // Host-only. Joiner implementations return a no-op unsubscribe.
  onJoinRequest(listener: (req: JoinRequest) => void): () => void;
  onToolApproval(listener: (req: PendingApproval) => void): () => void;
  // Fires when a pending approval settles for any reason (host decision,
  // 60s timeout, abort). The TUI uses this to dismiss the approval card
  // when the gate resolved internally.
  onToolApprovalResolved(listener: (id: string) => void): () => void;
  // Resolve a pending approval by id. Host-only — joiner implementations
  // are no-ops since approvals don't yet cross the wire.
  resolveToolApproval(id: string, decision: ToolApprovalDecision): void;

  submitPrompt(content: string): void;
  interrupt(reason?: string): void;
  /** Number of submissions waiting behind the in-flight turn (host) or
   * a best-effort estimate (joiner — currently always 0 since we don't
   * mirror queue state over the wire). */
  getQueueDepth(): number;
  onQueueChange(listener: (depth: number) => void): () => void;
  /** Transient: in-progress assistant text. Callback receives the current
   * accumulated text (empty string means cleared). Not persisted. */
  onStream(listener: (text: string) => void): () => void;
  /** Transient: tool execution progress. */
  onToolProgress(
    listener: (p: { toolUseId: string; toolName: string; elapsedSec: number }) => void,
  ): () => void;
  getStreamingText(): string;

  getEvents(): CoEvent[];
  getSlashCommands(): SlashCommand[];
  getParticipants(): Participant[];

  /** List the host repo's project files (git ls-files when available,
   * otherwise a filtered fs walk). On the joiner this is an RPC over the
   * wire — so it can fail/time out and return an empty list. */
  listFiles(): Promise<string[]>;
}

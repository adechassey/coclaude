import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { CoEvent } from "../types.js";
import type { Participant } from "../wire/protocol.js";

export interface JoinRequest {
  id: string;
  name: string;
  remoteAddress: string;
  resolve(decision: "approve" | "deny", reason?: string): void;
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

  submitPrompt(content: string): void;

  getEvents(): CoEvent[];
  getSlashCommands(): SlashCommand[];
  getParticipants(): Participant[];
}

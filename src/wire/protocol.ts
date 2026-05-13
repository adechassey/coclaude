// Wire protocol between coclaude host and joiners.
// JSON-encoded messages over WebSocket. One protocol version field bumps when
// the message shape changes; the host rejects connections with a mismatched
// version.

import type { CoEvent } from "../types.js";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";

export const PROTOCOL_VERSION = 1;

export interface Participant {
  name: string;
  connectedAt: number;
}

// Client → Server
export type ClientMessage =
  | {
      type: "hello";
      protocolVersion: number;
      name: string;
      since?: number;
    }
  | { type: "submit"; content: string }
  | { type: "interrupt"; reason?: string }
  | { type: "ping" };

// Server → Client
export type ServerMessage =
  | {
      type: "welcome";
      sessionId: string;
      hostName: string;
      yourName: string;
      events: CoEvent[];
      slashCommands: SlashCommand[];
      participants: Participant[];
    }
  | { type: "denied"; reason: string }
  | { type: "event"; event: CoEvent }
  | { type: "commands"; slashCommands: SlashCommand[] }
  | { type: "participants"; participants: Participant[] }
  | { type: "pong" };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decode<T extends ClientMessage | ServerMessage>(raw: string): T {
  // Caller is responsible for runtime validation if they care.
  return JSON.parse(raw) as T;
}

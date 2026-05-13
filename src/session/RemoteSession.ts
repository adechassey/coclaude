import WebSocket from "ws";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { CoEvent } from "../types.js";
import type { Participant } from "../wire/protocol.js";
import {
  PROTOCOL_VERSION,
  encode,
  decode,
  type ClientMessage,
  type ServerMessage,
} from "../wire/protocol.js";
import type {
  JoinRequest,
  SessionView,
  ToolApprovalRequest,
} from "./SessionView.js";

export interface RemoteSessionOptions {
  url: string;
  name: string;
  onClose?: (reason: string) => void;
  onDenied?: (reason: string) => void;
}

export class RemoteSession implements SessionView {
  readonly isHost = false;
  private _sessionId = "?";
  private _hostName = "?";
  private _myName: string;
  private ws: WebSocket;

  private events: CoEvent[] = [];
  private listeners = new Set<(event: CoEvent) => void>();

  private slashCommands: SlashCommand[] = [];
  private slashCommandsListeners = new Set<(c: SlashCommand[]) => void>();

  private participants: Participant[] = [];
  private participantsListeners = new Set<(p: Participant[]) => void>();

  private welcomed = false;
  private opts: RemoteSessionOptions;

  constructor(opts: RemoteSessionOptions) {
    this.opts = opts;
    this._myName = opts.name;
    this.ws = new WebSocket(opts.url);
    this.ws.on("open", () => this.sendHello());
    this.ws.on("message", (data) => this.onMessage(data.toString()));
    this.ws.on("close", (code, reason) => {
      const r = reason.toString() || `closed (code ${code})`;
      this.opts.onClose?.(r);
    });
    this.ws.on("error", (err) => {
      this.opts.onClose?.(err.message);
    });
  }

  get sessionId(): string {
    return this._sessionId;
  }
  get hostName(): string {
    return this._hostName;
  }
  get myName(): string {
    return this._myName;
  }

  on(listener: (event: CoEvent) => void): () => void {
    for (const e of this.events) listener(e);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onFuture(listener: (event: CoEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onSlashCommands(listener: (c: SlashCommand[]) => void): () => void {
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

  onJoinRequest(_listener: (req: JoinRequest) => void): () => void {
    return () => {
      // join requests are host-only
    };
  }

  onToolApproval(_listener: (req: ToolApprovalRequest) => void): () => void {
    return () => {
      // tool approvals are host-only
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

  submitPrompt(content: string): void {
    if (!this.welcomed) return;
    this.send({ type: "submit", content });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }

  // --- private ---

  private sendHello(): void {
    this.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      name: this._myName,
    });
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    }
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = decode<ServerMessage>(raw);
    } catch {
      return;
    }
    if (msg.type === "denied") {
      this.opts.onDenied?.(msg.reason);
      this.ws.close();
      return;
    }
    if (msg.type === "welcome") {
      this.welcomed = true;
      this._sessionId = msg.sessionId;
      this._hostName = msg.hostName;
      this._myName = msg.yourName;
      this.events = msg.events;
      this.slashCommands = msg.slashCommands;
      this.participants = msg.participants;
      // Dispatch snapshot to any early subscribers.
      for (const e of this.events) for (const l of this.listeners) l(e);
      for (const l of this.slashCommandsListeners) l(this.slashCommands);
      for (const l of this.participantsListeners) l(this.participants);
      return;
    }
    if (msg.type === "event") {
      this.events.push(msg.event);
      for (const l of this.listeners) l(msg.event);
      return;
    }
    if (msg.type === "commands") {
      this.slashCommands = msg.slashCommands;
      for (const l of this.slashCommandsListeners) l(this.slashCommands);
      return;
    }
    if (msg.type === "participants") {
      this.participants = msg.participants;
      for (const l of this.participantsListeners) l(this.participants);
      return;
    }
    // pong / unknown — ignore
  }
}

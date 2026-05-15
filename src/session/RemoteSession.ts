import WebSocket from "ws";
import { randomUUID } from "node:crypto";
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
  PendingApproval,
  SessionView,
  ToolApprovalDecision,
} from "./SessionView.js";
import { Topic } from "../util/Topic.js";
import { Stream } from "../util/Stream.js";

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

  private readonly slashCommandsTopic = new Topic<SlashCommand[]>([]);
  private readonly participantsTopic = new Topic<Participant[]>([]);
  private readonly streamingTextTopic = new Topic<string>("");
  private readonly toolProgressStream = new Stream<{
    toolUseId: string;
    toolName: string;
    elapsedSec: number;
  }>();

  private welcomed = false;
  private opts: RemoteSessionOptions;

  private pendingFileRequests = new Map<
    string,
    { resolve: (files: string[]) => void; timer: NodeJS.Timeout }
  >();

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
    return this.slashCommandsTopic.on(listener);
  }

  onParticipants(listener: (p: Participant[]) => void): () => void {
    return this.participantsTopic.on(listener);
  }

  onJoinRequest(_listener: (req: JoinRequest) => void): () => void {
    return () => {
      // join requests are host-only
    };
  }

  onToolApproval(_listener: (req: PendingApproval) => void): () => void {
    return () => {
      // tool approvals are host-only
    };
  }

  onToolApprovalResolved(_listener: (id: string) => void): () => void {
    return () => {
      // tool approvals are host-only
    };
  }

  resolveToolApproval(_id: string, _decision: ToolApprovalDecision): void {
    // host-only; no-op on the joiner side
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

  submitPrompt(content: string): void {
    if (!this.welcomed) return;
    this.send({ type: "submit", content });
  }

  interrupt(reason?: string): void {
    if (!this.welcomed) return;
    this.send(reason !== undefined ? { type: "interrupt", reason } : { type: "interrupt" });
  }

  getQueueDepth(): number {
    // We don't currently mirror the host's queue state over the wire.
    return 0;
  }

  onQueueChange(listener: (depth: number) => void): () => void {
    listener(0);
    return () => {
      // queue depth changes are host-only for now
    };
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

  listFiles(): Promise<string[]> {
    if (!this.welcomed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve([]);
    }
    const requestId = randomUUID();
    return new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingFileRequests.delete(requestId)) resolve([]);
      }, 5000);
      this.pendingFileRequests.set(requestId, { resolve, timer });
      this.send({ type: "list_files", requestId });
    });
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
      // Dispatch snapshot to any early subscribers.
      for (const e of this.events) for (const l of this.listeners) l(e);
      this.slashCommandsTopic.set(msg.slashCommands);
      this.participantsTopic.set(msg.participants);
      return;
    }
    if (msg.type === "event") {
      this.events.push(msg.event);
      for (const l of this.listeners) l(msg.event);
      return;
    }
    if (msg.type === "commands") {
      this.slashCommandsTopic.set(msg.slashCommands);
      return;
    }
    if (msg.type === "participants") {
      this.participantsTopic.set(msg.participants);
      return;
    }
    if (msg.type === "stream") {
      if (msg.reset) {
        this.streamingTextTopic.set(msg.delta ?? "");
      } else if (msg.delta !== undefined) {
        this.streamingTextTopic.set(
          this.streamingTextTopic.value + msg.delta,
        );
      }
      return;
    }
    if (msg.type === "tool_progress") {
      this.toolProgressStream.emit({
        toolUseId: msg.toolUseId,
        toolName: msg.toolName,
        elapsedSec: msg.elapsedSec,
      });
      return;
    }
    if (msg.type === "file_list") {
      const pending = this.pendingFileRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingFileRequests.delete(msg.requestId);
        pending.resolve(msg.files);
      }
      return;
    }
    // pong / unknown — ignore
  }
}

// Event types persisted to the disk session log and (in later milestones) broadcast on the wire.
// One event format — same on disk, same on the wire.

export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type CoEventInput = DistributiveOmit<CoEvent, "seq" | "ts">;

export type CoEvent =
  | UserPromptEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | ResultEvent
  | SystemEvent;

export interface BaseEvent {
  seq: number;
  ts: number;
}

export interface UserPromptEvent extends BaseEvent {
  type: "user_prompt";
  author: string;
  content: string;
}

export interface AssistantMessageEvent extends BaseEvent {
  type: "assistant_message";
  content: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  toolName: string;
  toolUseId: string;
  input: unknown;
  author: string;
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  toolUseId: string;
  content: unknown;
  isError?: boolean;
}

export interface ResultEvent extends BaseEvent {
  type: "result";
  subtype: string;
  durationMs: number;
  totalCostUsd: number;
  numTurns: number;
}

export interface SystemEvent extends BaseEvent {
  type: "system";
  subtype: string;
  payload?: unknown;
}

// Pure translation from Claude Agent SDK message shapes to coclaude's
// CoEvent vocabulary plus its two transient channels (streaming text and
// tool-call progress). All structural type guards and `unknown` casts that
// cross the SDK boundary live here — Session consumes the result without
// touching the SDK's content shapes itself.

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CoEventInput } from "../types.js";

// Structural subset of Anthropic's BetaRawMessageStreamEvent — we avoid
// importing the full beta type tree.
interface StreamEventLike {
  type: string;
  delta?: { type?: string; text?: string };
}

export type StreamingDelta =
  | { kind: "reset" }
  | { kind: "append"; text: string };

export interface ToolProgressTick {
  toolUseId: string;
  toolName: string;
  elapsedSec: number;
}

export interface TranslationResult {
  events: CoEventInput[];
  streamingDelta?: StreamingDelta;
  toolProgress?: ToolProgressTick;
}

export function translate(
  msg: SDKMessage,
  currentAuthor: string,
): TranslationResult {
  if (msg.type === "stream_event") {
    const e = (msg as unknown as { event: StreamEventLike }).event;
    return translateStreamEvent(e);
  }
  if ((msg as { type: string }).type === "tool_progress") {
    const tp = msg as unknown as {
      tool_use_id: string;
      tool_name: string;
      elapsed_time_seconds: number;
    };
    return {
      events: [],
      toolProgress: {
        toolUseId: tp.tool_use_id,
        toolName: tp.tool_name,
        elapsedSec: tp.elapsed_time_seconds,
      },
    };
  }
  if (msg.type === "assistant") {
    const m = (msg as unknown as { message: { content: unknown } }).message;
    const events: CoEventInput[] = [];
    const text = extractText(m.content);
    if (text) events.push({ type: "assistant_message", content: text });
    for (const t of extractToolUses(m.content)) {
      events.push({
        type: "tool_call",
        toolName: t.name,
        toolUseId: t.id,
        input: t.input,
        author: currentAuthor,
      });
    }
    // Final assistant message landed — clear the streaming buffer.
    return { events, streamingDelta: { kind: "reset" } };
  }
  if (msg.type === "user") {
    const m = (msg as unknown as { message: { content: unknown } }).message;
    const events: CoEventInput[] = [];
    for (const tr of extractToolResults(m.content)) {
      events.push({
        type: "tool_result",
        toolUseId: tr.tool_use_id,
        content: tr.content,
        ...(tr.is_error ? { isError: true } : {}),
      });
    }
    return { events };
  }
  if (msg.type === "result") {
    const r = msg as unknown as {
      subtype: string;
      duration_ms: number;
      total_cost_usd: number;
      num_turns: number;
    };
    return {
      events: [
        {
          type: "result",
          subtype: r.subtype,
          durationMs: r.duration_ms,
          totalCostUsd: r.total_cost_usd,
          numTurns: r.num_turns,
        },
      ],
    };
  }
  // Unknown SDK message type — preserve the raw payload as a system event so
  // upstream additions don't get silently dropped.
  const sys = msg as { type: string; subtype?: string };
  return {
    events: [
      {
        type: "system",
        subtype: sys.subtype ?? msg.type,
        payload: msg,
      },
    ],
  };
}

function translateStreamEvent(e: StreamEventLike): TranslationResult {
  if (e.type === "message_start") {
    return { events: [], streamingDelta: { kind: "reset" } };
  }
  if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
    const text = e.delta.text ?? "";
    if (text) {
      return { events: [], streamingDelta: { kind: "append", text } };
    }
  }
  // content_block_start / content_block_stop / message_delta / message_stop —
  // ignored for v1.
  return { events: [] };
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

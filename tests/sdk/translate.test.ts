import { describe, expect, it } from "vitest";
import { translate } from "../../src/sdk/translate.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// Helper: cast a structural object into the SDKMessage type so we can feed
// fixtures without dragging in the full SDK type tree.
const sdk = (msg: object): SDKMessage => msg as unknown as SDKMessage;

describe("translate", () => {
  describe("assistant message", () => {
    it("extracts text content into an assistant_message event", () => {
      const r = translate(
        sdk({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hello world" }],
          },
        }),
        "alice",
      );
      expect(r.events).toEqual([
        { type: "assistant_message", content: "hello world" },
      ]);
      expect(r.streamingDelta).toEqual({ kind: "reset" });
    });

    it("extracts tool_use blocks with author attribution", () => {
      const r = translate(
        sdk({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "abc", name: "Bash", input: { command: "ls" } },
            ],
          },
        }),
        "bob",
      );
      expect(r.events).toEqual([
        {
          type: "tool_call",
          toolName: "Bash",
          toolUseId: "abc",
          input: { command: "ls" },
          author: "bob",
        },
      ]);
    });

    it("emits both text and tool_use blocks in order", () => {
      const r = translate(
        sdk({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "running" },
              { type: "tool_use", id: "t1", name: "Read", input: { path: "/a" } },
            ],
          },
        }),
        "host",
      );
      expect(r.events).toHaveLength(2);
      expect(r.events[0]).toMatchObject({ type: "assistant_message" });
      expect(r.events[1]).toMatchObject({ type: "tool_call", toolName: "Read" });
    });

    it("omits assistant_message when no text content", () => {
      const r = translate(
        sdk({
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] },
        }),
        "host",
      );
      expect(r.events.every((e) => e.type !== "assistant_message")).toBe(true);
    });

    it("always resets the streaming buffer", () => {
      const r = translate(
        sdk({ type: "assistant", message: { content: [] } }),
        "host",
      );
      expect(r.streamingDelta).toEqual({ kind: "reset" });
    });
  });

  describe("user message (tool results)", () => {
    it("extracts tool_result blocks", () => {
      const r = translate(
        sdk({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "abc", content: "ok" },
            ],
          },
        }),
        "host",
      );
      expect(r.events).toEqual([
        { type: "tool_result", toolUseId: "abc", content: "ok" },
      ]);
    });

    it("preserves is_error flag", () => {
      const r = translate(
        sdk({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "x", content: "boom", is_error: true },
            ],
          },
        }),
        "host",
      );
      expect(r.events[0]).toMatchObject({ isError: true });
    });
  });

  describe("result message", () => {
    it("maps to a result CoEvent with renamed fields", () => {
      const r = translate(
        sdk({
          type: "result",
          subtype: "success",
          duration_ms: 1234,
          total_cost_usd: 0.05,
          num_turns: 3,
        }),
        "host",
      );
      expect(r.events).toEqual([
        {
          type: "result",
          subtype: "success",
          durationMs: 1234,
          totalCostUsd: 0.05,
          numTurns: 3,
        },
      ]);
    });
  });

  describe("stream_event", () => {
    it("message_start resets streaming buffer", () => {
      const r = translate(
        sdk({ type: "stream_event", event: { type: "message_start" } }),
        "host",
      );
      expect(r.events).toEqual([]);
      expect(r.streamingDelta).toEqual({ kind: "reset" });
    });

    it("content_block_delta with text_delta appends text", () => {
      const r = translate(
        sdk({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hello" },
          },
        }),
        "host",
      );
      expect(r.streamingDelta).toEqual({ kind: "append", text: "hello" });
    });

    it("ignores empty text deltas", () => {
      const r = translate(
        sdk({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "" },
          },
        }),
        "host",
      );
      expect(r.streamingDelta).toBeUndefined();
    });

    it("ignores non-text deltas", () => {
      const r = translate(
        sdk({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
        "host",
      );
      expect(r.events).toEqual([]);
      expect(r.streamingDelta).toBeUndefined();
    });
  });

  describe("tool_progress", () => {
    it("maps to a toolProgress tick", () => {
      const r = translate(
        sdk({
          type: "tool_progress",
          tool_use_id: "t1",
          tool_name: "Bash",
          elapsed_time_seconds: 5,
        }),
        "host",
      );
      expect(r.events).toEqual([]);
      expect(r.toolProgress).toEqual({
        toolUseId: "t1",
        toolName: "Bash",
        elapsedSec: 5,
      });
    });
  });

  describe("unknown SDK message type", () => {
    it("falls back to a system event preserving the raw payload", () => {
      const raw = { type: "future_thing", subtype: "weird", payload: { x: 1 } };
      const r = translate(sdk(raw), "host");
      expect(r.events).toEqual([
        { type: "system", subtype: "weird", payload: raw },
      ]);
    });

    it("uses the type as subtype when no subtype is present", () => {
      const r = translate(sdk({ type: "future_thing" }), "host");
      expect(r.events[0]).toMatchObject({ type: "system", subtype: "future_thing" });
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  decode,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "../../src/wire/protocol.js";

describe("protocol.encode / decode", () => {
  it("round-trips a hello message", () => {
    const msg: ClientMessage = {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      name: "alice",
    };
    expect(decode<ClientMessage>(encode(msg))).toEqual(msg);
  });

  it("round-trips a welcome message with events", () => {
    const msg: ServerMessage = {
      type: "welcome",
      sessionId: "sid",
      hostName: "host",
      yourName: "alice",
      events: [
        {
          seq: 0,
          ts: 1,
          type: "user_prompt",
          author: "host",
          content: "hi",
        },
      ],
      slashCommands: [],
      participants: [{ name: "alice", connectedAt: 100 }],
    };
    expect(decode<ServerMessage>(encode(msg))).toEqual(msg);
  });

  it("round-trips transient stream/tool_progress messages", () => {
    const stream: ServerMessage = { type: "stream", delta: "hi", reset: true };
    expect(decode<ServerMessage>(encode(stream))).toEqual(stream);

    const progress: ServerMessage = {
      type: "tool_progress",
      toolUseId: "t1",
      toolName: "Bash",
      elapsedSec: 5,
    };
    expect(decode<ServerMessage>(encode(progress))).toEqual(progress);
  });
});

describe("PROTOCOL_VERSION", () => {
  it("is a number greater than zero", () => {
    expect(typeof PROTOCOL_VERSION).toBe("number");
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

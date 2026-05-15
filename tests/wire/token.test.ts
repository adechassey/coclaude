import { describe, expect, it } from "vitest";
import {
  buildJoinUrl,
  generateToken,
  parseJoinUrl,
} from "../../src/wire/token.js";

describe("generateToken", () => {
  it("returns a base64url string of the right length", () => {
    const t = generateToken();
    // 24 bytes → base64url has no padding and is ceil(24*4/3) = 32 chars
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBe(32);
  });

  it("produces distinct values across calls", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("honors a custom byteLength", () => {
    const t = generateToken(6);
    expect(t.length).toBe(8); // ceil(6*4/3) = 8
  });
});

describe("buildJoinUrl", () => {
  it("formats host/port/token into a ws:// URL with /s/<token>", () => {
    expect(buildJoinUrl("127.0.0.1", 4000, "abc")).toBe(
      "ws://127.0.0.1:4000/s/abc",
    );
  });
});

describe("parseJoinUrl", () => {
  it("round-trips a buildJoinUrl result", () => {
    const url = buildJoinUrl("127.0.0.1", 4000, "abc_xyz-123");
    expect(parseJoinUrl(url)).toEqual({
      host: "127.0.0.1",
      port: 4000,
      token: "abc_xyz-123",
      secure: false,
    });
  });

  it("parses a wss:// URL as secure", () => {
    expect(parseJoinUrl("wss://relay.example.com:443/s/tok")).toEqual({
      host: "relay.example.com",
      port: 443,
      token: "tok",
      secure: true,
    });
  });

  it("defaults port to 80 for ws and 443 for wss when absent", () => {
    expect(parseJoinUrl("ws://h/s/tok").port).toBe(80);
    expect(parseJoinUrl("wss://h/s/tok").port).toBe(443);
  });

  it("rejects non-ws protocols", () => {
    expect(() => parseJoinUrl("http://h/s/tok")).toThrow(/unsupported protocol/);
    expect(() => parseJoinUrl("https://h/s/tok")).toThrow(/unsupported protocol/);
  });

  it("rejects URLs without a /s/<token> path", () => {
    expect(() => parseJoinUrl("ws://h:80/")).toThrow(/invalid join URL/);
    expect(() => parseJoinUrl("ws://h:80/wrong")).toThrow(/invalid join URL/);
    expect(() => parseJoinUrl("ws://h:80/s/")).toThrow(/invalid join URL/);
  });

  it("tolerates a trailing slash on the path", () => {
    expect(parseJoinUrl("ws://h:80/s/tok/").token).toBe("tok");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Authorizer } from "../../src/policy/Authorizer.js";
import type { CoEventInput } from "../../src/types.js";
import type {
  PendingApproval,
  ToolApprovalDecision,
} from "../../src/session/SessionView.js";

function makeAuthorizer(hostName = "host") {
  const emitted: CoEventInput[] = [];
  const requests: PendingApproval[] = [];
  const resolutions: string[] = [];
  const a = new Authorizer({ hostName, emit: (e) => emitted.push(e) });
  a.onApprovalRequest((r) => requests.push(r));
  a.onApprovalResolved((id) => resolutions.push(id));
  return { authorizer: a, emitted, requests, resolutions };
}

// Shared default DecideRequest fields — every test customizes from here.
function decide(
  authorizer: Authorizer,
  partial: Partial<{
    author: string;
    toolName: string;
    input: Record<string, unknown>;
    toolUseId: string;
    controller: AbortController;
  }> = {},
) {
  const controller = partial.controller ?? new AbortController();
  return {
    promise: authorizer.decide({
      author: partial.author ?? "alice",
      toolName: partial.toolName ?? "Read",
      input: partial.input ?? {},
      toolUseId: partial.toolUseId ?? "t1",
      signal: controller.signal,
    }),
    controller,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Authorizer.getScope", () => {
  it("returns unrestricted for the host", () => {
    const { authorizer } = makeAuthorizer("h");
    expect(authorizer.getScope("h")).toBe("unrestricted");
  });

  it("returns DEFAULT_SCOPE (readonly) for unknown joiners", () => {
    const { authorizer } = makeAuthorizer();
    expect(authorizer.getScope("ghost")).toBe("readonly");
  });

  it("returns DEFAULT_SCOPE after initParticipant", () => {
    const { authorizer } = makeAuthorizer();
    authorizer.initParticipant("alice");
    expect(authorizer.getScope("alice")).toBe("readonly");
  });

  it("forgets a participant on forgetParticipant", () => {
    const { authorizer } = makeAuthorizer();
    authorizer.grant({ name: "alice", scope: "bash", by: "host", participantExists: true });
    expect(authorizer.getScope("alice")).toBe("bash");
    authorizer.forgetParticipant("alice");
    // After forgetting, the joiner is back to the default — same as a fresh joiner.
    expect(authorizer.getScope("alice")).toBe("readonly");
  });
});

describe("Authorizer.grant / revoke", () => {
  it("grant emits scope_changed and updates getScope", () => {
    const { authorizer, emitted } = makeAuthorizer();
    const result = authorizer.grant({
      name: "alice",
      scope: "bash",
      by: "host",
      participantExists: true,
    });
    expect(result).toEqual({ ok: true, scope: "bash" });
    expect(authorizer.getScope("alice")).toBe("bash");
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "scope_changed",
      payload: { name: "alice", scope: "bash", by: "host" },
    });
  });

  it("grant refuses an unknown participant with a reason and emits nothing", () => {
    const { authorizer, emitted } = makeAuthorizer();
    const result = authorizer.grant({
      name: "ghost",
      scope: "bash",
      by: "host",
      participantExists: false,
    });
    expect(result).toEqual({ ok: false, reason: "no participant named 'ghost'" });
    expect(authorizer.getScope("ghost")).toBe("readonly");
    expect(emitted).toEqual([]);
  });

  it("revoke resets to readonly and emits scope_changed", () => {
    const { authorizer, emitted } = makeAuthorizer();
    authorizer.grant({ name: "alice", scope: "bash", by: "host", participantExists: true });
    emitted.length = 0;
    const result = authorizer.revoke({ name: "alice", by: "host", participantExists: true });
    expect(result).toEqual({ ok: true, scope: "readonly" });
    expect(authorizer.getScope("alice")).toBe("readonly");
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "scope_changed",
      payload: { name: "alice", scope: "readonly", by: "host" },
    });
  });

  it("revoke refuses an unknown participant", () => {
    const { authorizer } = makeAuthorizer();
    const result = authorizer.revoke({ name: "ghost", by: "host", participantExists: false });
    expect(result).toEqual({ ok: false, reason: "no participant named 'ghost'" });
  });
});

describe("Authorizer.decide — host bypass", () => {
  it("allows any tool when author is the host", async () => {
    const { authorizer, emitted, requests } = makeAuthorizer("host");
    const { promise } = decide(authorizer, { author: "host", toolName: "Bash" });
    await expect(promise).resolves.toEqual({ behavior: "allow", updatedInput: {} });
    expect(requests).toEqual([]);
    expect(emitted).toEqual([]);
  });
});

describe("Authorizer.decide — in-scope auto-approve", () => {
  it("allows Read for a readonly joiner and emits tool_auto_approved", async () => {
    const { authorizer, emitted, requests } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise } = decide(authorizer, { author: "alice", toolName: "Read" });
    await expect(promise).resolves.toMatchObject({ behavior: "allow" });
    expect(requests).toEqual([]);
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "tool_auto_approved",
      payload: { author: "alice", toolName: "Read", scope: "readonly", toolUseId: "t1" },
    });
  });

  it("allows Bash for a joiner promoted to bash scope", async () => {
    const { authorizer } = makeAuthorizer();
    authorizer.grant({ name: "alice", scope: "bash", by: "host", participantExists: true });
    const { promise } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await expect(promise).resolves.toMatchObject({ behavior: "allow" });
  });
});

describe("Authorizer.decide — host decision flow", () => {
  it("publishes a PendingApproval and resolves on approve", async () => {
    const { authorizer, requests, emitted, resolutions } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise } = decide(authorizer, {
      author: "alice",
      toolName: "Bash",
      input: { command: "ls" },
    });
    // The request should be published synchronously inside decide()'s microtask.
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      author: "alice",
      toolName: "Bash",
      currentScope: "readonly",
      input: { command: "ls" },
    });
    expect(requests[0]!.id).toBeTypeOf("string");

    authorizer.resolveApproval(requests[0]!.id, { decision: "approve" });
    await expect(promise).resolves.toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "tool_approved",
      payload: {
        author: "alice",
        toolName: "Bash",
        toolUseId: "t1",
        reason: undefined,
      },
    });
    expect(resolutions).toEqual([requests[0]!.id]);
  });

  it("denies with the host's reason", async () => {
    const { authorizer, requests, emitted } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await Promise.resolve();
    authorizer.resolveApproval(requests[0]!.id, {
      decision: "deny",
      reason: "not now",
    });
    await expect(promise).resolves.toEqual({ behavior: "deny", message: "not now" });
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "tool_denied",
      payload: {
        author: "alice",
        toolName: "Bash",
        toolUseId: "t1",
        reason: "not now",
      },
    });
  });

  it("ignores resolve for an unknown approval id", async () => {
    const { authorizer } = makeAuthorizer();
    // Should not throw.
    authorizer.resolveApproval("nope", { decision: "approve" });
  });
});

describe("Authorizer.decide — scope promotion", () => {
  it("promotes the joiner's scope on approve+promoteScope", async () => {
    const { authorizer, requests, emitted } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await Promise.resolve();
    authorizer.resolveApproval(requests[0]!.id, {
      decision: "approve",
      promoteScope: "bash",
    });
    await promise;
    expect(authorizer.getScope("alice")).toBe("bash");
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "scope_changed",
      payload: { name: "alice", scope: "bash", by: "host" },
    });
  });

  it("scope promotion makes the next equivalent call auto-approve", async () => {
    const { authorizer, requests } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise: p1 } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await Promise.resolve();
    authorizer.resolveApproval(requests[0]!.id, { decision: "approve", promoteScope: "bash" });
    await p1;

    requests.length = 0;
    const { promise: p2 } = decide(authorizer, {
      author: "alice",
      toolName: "Bash",
      toolUseId: "t2",
    });
    await expect(p2).resolves.toMatchObject({ behavior: "allow" });
    expect(requests).toEqual([]);
  });
});

describe("Authorizer.decide — timeout", () => {
  it("auto-denies after 60s if the host doesn't decide", async () => {
    vi.useFakeTimers();
    const { authorizer, emitted, resolutions, requests } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    await expect(promise).resolves.toEqual({
      behavior: "deny",
      message: "approval timed out (60s)",
    });
    expect(emitted).toContainEqual({
      type: "system",
      subtype: "tool_denied",
      payload: {
        author: "alice",
        toolName: "Bash",
        toolUseId: "t1",
        reason: "approval timed out (60s)",
      },
    });
    expect(resolutions).toEqual([requests[0]!.id]);
  });
});

describe("Authorizer.decide — abort", () => {
  it("denies with 'aborted' when the SDK signal aborts", async () => {
    const { authorizer, requests, resolutions } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise, controller } = decide(authorizer, {
      author: "alice",
      toolName: "Bash",
    });
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    controller.abort();
    await expect(promise).resolves.toEqual({
      behavior: "deny",
      message: "aborted",
    });
    expect(resolutions).toEqual([requests[0]!.id]);
  });

  it("a later host decision after abort is ignored (settle-once)", async () => {
    const { authorizer, requests } = makeAuthorizer();
    authorizer.initParticipant("alice");
    const { promise, controller } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await Promise.resolve();
    controller.abort();
    await promise;
    // Idempotent — must not throw, must not double-settle.
    authorizer.resolveApproval(requests[0]!.id, { decision: "approve" });
  });
});

describe("Authorizer.onApprovalResolved", () => {
  it("fires for every settlement reason exactly once", async () => {
    const { authorizer, resolutions, requests } = makeAuthorizer();
    authorizer.initParticipant("alice");

    // Settle by host decision.
    const { promise: p1 } = decide(authorizer, { author: "alice", toolName: "Bash" });
    await Promise.resolve();
    authorizer.resolveApproval(requests[0]!.id, { decision: "approve" });
    await p1;
    expect(resolutions).toHaveLength(1);

    // Settle by abort.
    requests.length = 0;
    const { promise: p2, controller } = decide(authorizer, {
      author: "alice",
      toolName: "Bash",
      toolUseId: "t2",
    });
    await Promise.resolve();
    controller.abort();
    await p2;
    expect(resolutions).toHaveLength(2);
  });
});

// Sanity: nothing in the public surface is sensitive to the ToolApprovalDecision
// shape's extra fields.
const _typecheck: ToolApprovalDecision = { decision: "approve" };
void _typecheck;

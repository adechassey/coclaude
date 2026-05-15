// The single module that owns "who is allowed to do what." Holds the per-
// joiner scope map, decides tool-call authorization at runtime, publishes
// pending approvals to subscribers (the host TUI), and resolves them by id.
// Host turns bypass entirely — the host's settings.json governs them.

import { randomUUID } from "node:crypto";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_SCOPE, isInScope, type Scope } from "./scopes.js";
import { Stream } from "../util/Stream.js";
import type { CoEventInput } from "../types.js";
import type {
  PendingApproval,
  ToolApprovalDecision,
} from "../session/SessionView.js";

export interface AuthorizerOptions {
  hostName: string;
  emit: (event: CoEventInput) => void;
}

export interface DecideRequest {
  author: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  signal: AbortSignal;
}

export type GrantResult =
  | { ok: true; scope: Scope }
  | { ok: false; reason: string };

interface InFlight {
  request: PendingApproval;
  settle: (decision: ToolApprovalDecision) => void;
}

export class Authorizer {
  private readonly hostName: string;
  private readonly emit: (event: CoEventInput) => void;
  private readonly scopes = new Map<string, Scope>();
  private readonly pending = new Map<string, InFlight>();
  private readonly approvalStream = new Stream<PendingApproval>();
  private readonly resolutionStream = new Stream<string>();

  constructor(opts: AuthorizerOptions) {
    this.hostName = opts.hostName;
    this.emit = opts.emit;
  }

  // Scope state ---------------------------------------------------------

  getScope(name: string): Scope {
    if (name === this.hostName) return "unrestricted";
    return this.scopes.get(name) ?? DEFAULT_SCOPE;
  }

  initParticipant(name: string): void {
    if (!this.scopes.has(name)) this.scopes.set(name, DEFAULT_SCOPE);
  }

  forgetParticipant(name: string): void {
    this.scopes.delete(name);
  }

  // Caller (typically Session's /grant command) tells us whether the
  // participant is currently connected — Authorizer doesn't own that list.
  grant(opts: {
    name: string;
    scope: Scope;
    by: string;
    participantExists: boolean;
  }): GrantResult {
    if (!opts.participantExists) {
      return { ok: false, reason: `no participant named '${opts.name}'` };
    }
    this.scopes.set(opts.name, opts.scope);
    this.emit({
      type: "system",
      subtype: "scope_changed",
      payload: { name: opts.name, scope: opts.scope, by: opts.by },
    });
    return { ok: true, scope: opts.scope };
  }

  revoke(opts: {
    name: string;
    by: string;
    participantExists: boolean;
  }): GrantResult {
    if (!opts.participantExists) {
      return { ok: false, reason: `no participant named '${opts.name}'` };
    }
    this.scopes.set(opts.name, DEFAULT_SCOPE);
    this.emit({
      type: "system",
      subtype: "scope_changed",
      payload: { name: opts.name, scope: DEFAULT_SCOPE, by: opts.by },
    });
    return { ok: true, scope: DEFAULT_SCOPE };
  }

  // Runtime decision ----------------------------------------------------

  async decide(req: DecideRequest): Promise<PermissionResult> {
    if (req.author === this.hostName) {
      return { behavior: "allow", updatedInput: req.input };
    }
    const scope = this.getScope(req.author);
    if (isInScope(req.toolName, scope)) {
      this.emit({
        type: "system",
        subtype: "tool_auto_approved",
        payload: {
          author: req.author,
          toolName: req.toolName,
          scope,
          toolUseId: req.toolUseId,
        },
      });
      return { behavior: "allow", updatedInput: req.input };
    }

    const decision = await this.awaitHostDecision({
      author: req.author,
      toolName: req.toolName,
      input: req.input,
      currentScope: scope,
      signal: req.signal,
    });

    if (decision.promoteScope) {
      this.scopes.set(req.author, decision.promoteScope);
      this.emit({
        type: "system",
        subtype: "scope_changed",
        payload: {
          name: req.author,
          scope: decision.promoteScope,
          by: this.hostName,
        },
      });
    }

    this.emit({
      type: "system",
      subtype:
        decision.decision === "approve" ? "tool_approved" : "tool_denied",
      payload: {
        author: req.author,
        toolName: req.toolName,
        toolUseId: req.toolUseId,
        reason: decision.reason,
      },
    });

    if (decision.decision === "approve") {
      return { behavior: "allow", updatedInput: req.input };
    }
    return {
      behavior: "deny",
      message: decision.reason ?? "denied by host",
    };
  }

  // Approval UX ---------------------------------------------------------

  onApprovalRequest(listener: (req: PendingApproval) => void): () => void {
    return this.approvalStream.on(listener);
  }

  // Fires after an approval settles for any reason (host decision, 60s
  // timeout, abort). Subscribers (the TUI) use this to dismiss stale UI
  // when the gate resolved internally before the host pressed a key.
  onApprovalResolved(listener: (id: string) => void): () => void {
    return this.resolutionStream.on(listener);
  }

  resolveApproval(id: string, decision: ToolApprovalDecision): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    entry.settle(decision);
  }

  // Internal coordinator: publish a PendingApproval, then race the host's
  // decision against a 60s timer and the SDK abort signal.
  private awaitHostDecision(opts: {
    author: string;
    toolName: string;
    input: Record<string, unknown>;
    currentScope: Scope;
    signal: AbortSignal;
  }): Promise<ToolApprovalDecision> {
    return new Promise((resolve) => {
      const id = randomUUID();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle = (d: ToolApprovalDecision): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        this.resolutionStream.emit(id);
        resolve(d);
      };

      const request: PendingApproval = {
        id,
        author: opts.author,
        toolName: opts.toolName,
        input: opts.input,
        currentScope: opts.currentScope,
      };

      this.pending.set(id, { request, settle });
      this.approvalStream.emit(request);

      timer = setTimeout(
        () =>
          settle({ decision: "deny", reason: "approval timed out (60s)" }),
        60_000,
      );

      opts.signal.addEventListener("abort", () => {
        settle({ decision: "deny", reason: "aborted" });
      });
    });
  }
}

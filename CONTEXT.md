# Context

Domain vocabulary for `coclaude`. Use these names exactly in code, comments, and architectural discussion. New terms get added here as they crystallize; out-of-date terms get fixed or deleted.

For the broader design rationale, see [PLAN.md](./PLAN.md). For day-to-day guidance, see [CLAUDE.md](./CLAUDE.md).

## Roles

**Host** — the process that owns the SDK-driven Claude Code session and runs the WebSocket server. Exactly one per coclaude session. Identified by `hostName`. Implemented by `Session` (`src/session/Session.ts`).

**Joiner** — a remote participant connected to the host over WS. Zero or more per session. Identified by `name`. Mirrored locally by `RemoteSession` (`src/session/RemoteSession.ts`), which satisfies the same `SessionView` interface as `Session` so the TUI is role-agnostic.

**Author** — the human (host or joiner) credited with originating a prompt. Carried as a string on `user_prompt` events and on every tool-call decision. `Author === hostName` is the host-turn signal that bypasses approval.

## Authorization

**Scope** — a joiner's authority level: `readonly | edits | bash | unrestricted`. Stored per-joiner, mutated via `/grant`, `/revoke`, or scope-promotion at approval time. Defined in `src/policy/scopes.ts`.

**Authorizer** — the single module that owns "who is allowed to do what." Owns scope state, decides tool-call authorization at runtime, publishes pending approvals to the host TUI, and resolves them by ID. Replaces the scope map + `canUseTool` flow currently inlined in `Session`. Status: deepening candidate, not yet extracted.

**Tool-call approval** — the host's yes/no decision on a joiner-initiated tool call that falls outside their scope. The 60s timeout, scope-promotion side effect, and abort-signal handling all live inside the Authorizer's coordinator seam.

**Pending approval** — a serializable record of an in-flight approval request: `{ id, author, toolName, input, currentScope }`. Resolved by `authorizer.resolveApproval(id, decision)` — no resolver function attached to the payload, so the same shape crosses both in-process and WS boundaries.

## Events

**CoEvent** — the union type in `src/types.ts` covering everything that becomes part of the persistent conversation record. One format for the on-disk JSONL log, the in-memory ring buffer, and the wire fan-out to joiners. *Not* used for streaming text deltas or tool-progress ticks — those go through dedicated transient channels (see `setStreaming`, `notifyToolProgress`).

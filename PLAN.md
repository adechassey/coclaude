# coclaude — Project Plan

## What we're building

`coclaude` is a multiplayer Claude Code application built on the Claude Code SDK. The host process runs an SDK-driven Claude Code session and exposes a WebSocket server. Multiple participants (the host included) collaborate through structured author-tagged events: prompts, slash commands, tool-call approvals, interrupts. The on-wire event log is also the on-disk session log, which is also the audit trail.

This document captures the design decisions (with rationale) and the milestone plan to v1.

## Architectural pivot from the initial sketch

The original brainstorm framed coclaude as a transparent PTY wrapper around the `claude` CLI: spawn `claude`, forward stdin/stdout, multiplex to remote clients. The design grilling moved us to a fundamentally different architecture: **coclaude *is* a Claude Code application that uses the Claude Code SDK programmatically.** The host doesn't launch `claude` and let coclaude wrap it — they launch `coclaude host` directly, which runs its own Claude Code session via the SDK.

Why we pivoted:

1. Multiplexing a TUI byte stream to N clients with different terminal sizes is the wrong primitive — you spend the project building a terminal multiplexer instead of a collab tool.
2. Author-tagged structured events compose far better than tagged keystrokes.
3. The SDK gives us first-class hooks for tool approval, interrupts (via `AbortSignal`), and session resumption that the interactive TUI doesn't expose.
4. The host's experience can still feel like Claude Code (mimicked TUI in `ink`) without needing to scrape Claude Code's actual TUI bytes.

The README's framing has been updated to match.

## Design decisions

15 foundational decisions in roughly dependency order. Each was ground out during design grilling; the rationale lives here so future contributors can understand why we picked each branch.

### 1. Host vs joiner symmetry → **Symmetric**

Every participant — host included — has a local compose pane and submits author-tagged prompts. The host is *not* a privileged "untagged" voice. This keeps turn-taking, attribution, audit, and replay uniform; the price is that "transparent wrapper around vanilla Claude Code" was never a real goal anyway.

### 2. Input model → **Fully structured wire protocol**

All input is typed events with an author — no raw keystrokes ever cross the network. Slash commands, tool-call approvals, and interrupts are explicit event types. This means the host's `settings.json` allow-lists scope to host-authored turns only; joiners always go through coclaude's own approval policy regardless of what `settings.json` permits.

### 3. Output rendering → **Structured events into a custom TUI** (with virtual-terminal fallback)

Each client renders an `ink`-based TUI from structured events emitted by the SDK. If the SDK proves insufficient — e.g., doesn't expose enough structure around tool-approval flow, interrupts, or slash-command output — we fall back to a server-side virtual-terminal model (xterm-headless or equivalent) and render that per-client. SDK sufficiency is a pre-flight verification item.

### 4. Underlying mechanism → **Claude Code SDK, used programmatically**

No subprocess to the `claude` CLI; no PTY anywhere. coclaude is a Claude Code application that uses the published SDK. Versioning is tied to the SDK; the user's `claude` CLI is incidental (we may use the same auth credentials, but we don't shell out).

### 5. Concurrency model → **FIFO queue + explicit interrupt event**

Anyone can submit a prompt any time. Concurrent submissions queue in order. Anyone can submit an `interrupt` event which aborts the in-flight SDK call. An optional `--driver-lock` mode exists for meeting-style discipline, but the default is unlocked queue + interrupt.

### 6. Attribution → **System-prompt convention + literal `[name]` prefix**

The session-start system prompt establishes the convention:

> *This is a multiplayer session. Each user message is prefixed with `[name]` to indicate the author. Address authors by name when responding to their specific requests. When multiple authors participate, surface disagreements rather than averaging them silently.*

Inbound: every user message gets `[name]` prefixed before going to the SDK. Outbound attribution is server-side bookkeeping — the in-flight turn's author owns every tool call Claude makes in response. Claude doesn't have to declare authorship; we just stamp it on the events.

### 7. Session model → **One session per host invocation, resumable**

A `coclaude host` invocation owns one Claude Code session. `--resume <session-id>` reattaches to a prior session by rebuilding state from its on-disk log. The wire protocol reserves a `session_id` field for v2 multi-session multiplexing within a single host process.

### 8. Config inheritance → **Full inheritance + approval gating for non-host authors**

The host's full Claude Code configuration loads as normal — auth, CLAUDE.md (project + user), `settings.json`, custom agents, skills, MCP servers, hooks, memory files. But every shell-touching tool call attributed to a non-host author goes through the approval policy. `settings.json` permission rules auto-approve only host-authored turns; joiners always re-prompt regardless.

Hooks fire normally regardless of triggering author, but the triggering tool call carries author attribution in the audit log: `[alice]` `Bash(npm test)` `→ Hook X fired`.

### 9. Approval UX → **Pre-authorized scopes + per-call prompt outside scope**

Four scopes, with a `readonly` default for new joiners:

- `readonly` — Read, Glob, Grep, lookups. No state change anywhere.
- `edits` — readonly + Edit, Write, MultiEdit on files inside the cwd.
- `bash` — edits + Bash, scoped to commands matching the host's `settings.json` allow-list. Bash commands outside the allow-list still prompt.
- `unrestricted` — everything. Functionally shell access.

Tool calls inside scope auto-approve and log with author tag. Tool calls outside scope trigger a blocking prompt on the host's TUI with 60s auto-deny:

```
┌─ tool-call approval ──────────────────────────────────┐
│ [alice] wants to run: Bash(npm install left-pad)      │
│ (alice's scope: readonly)                             │
│ [a]pprove once  [s]ession  [d]eny  [p]romote scope    │
└────────────────────────────────────────────────────────┘
```

The host's own tool calls bypass entirely — governed by their `settings.json`. Plan-mode batch approval (Q9 Option F) is deferred to v1.1.

### 10. Interrupt semantics → **Abort + structured marker in history**

The interrupt event aborts the in-flight SDK call via `AbortSignal`. The partial assistant response is replaced by a structured `[interrupted by <name>]` marker with an optional `reason` payload:

```
[alice] refactor auth
<claude: starts responding, runs a Read tool call>
[interrupted by bob: "preserve the existing OAuth flow"]
[bob] just clean up the helper, keep OAuth intact
<claude: starts a fresh response addressing bob>
```

In-flight tool subprocesses receive SIGTERM, then SIGKILL after a ~5s grace period. Intended-but-unstarted tool calls are cancelled. Tool calls that already completed remain in history (they're not reversible anyway).

### 11. Connectivity → **Transport-agnostic WebSocket + cloudflared shell-out**

coclaude exposes a WebSocket server, bound to `127.0.0.1` by default. Users choose their tunnel: Tailscale (`--bind 100.x.x.x`), `--tunnel` (spawns `cloudflared` as a child process and inlines the public URL into the printed join command), or any third-party tunneling tool (ngrok, frp, ssh -L, …) — coclaude doesn't care. Mandatory per-session join token in every connection URL. No app-level TLS — tunnel/network handles encryption.

Hosted relay (Q11 Option D) is deferred indefinitely.

### 12. Replay & reconnect → **Ring buffer + `seq`-based resume; wire log = disk log**

Every event has a monotonically-increasing `seq`, a timestamp, a type, an author (or `null` for system events), and a payload. The last ~500 events live in memory as a ring buffer; older events live on disk only.

Fresh join and reconnect are the same code path: client passes `?since=<seq>` in the handshake. Server replays from there — from memory if recent, from disk if older, full ring if no `since`.

The on-wire event format **is** the on-disk session log format. One source of truth for:
- Replay on join / reconnect
- `--resume <session-id>` (rebuild SDK state from disk log)
- Audit log (filtered view of the disk log)
- Transcript export (markdown rendering of the disk log)

### 13. TUI design → **Mimic Claude Code's TUI with minimal always-visible chrome**

Built with `ink`. Layout should feel like Claude Code so existing users don't bounce off:

- Scrollable conversation history (top)
- Compose pane (bottom)
- Status bar with multiplayer chrome:
  ```
  coclaude • alice (host) • 2 connected: bob[edits], charlie[readonly] • queue: 1 • join: wss://…?token=…
  ```
- Author prefixes (`[alice]`) appear on history items the moment a 2nd participant arrives; single-player mode elides the host's own prefix.
- Tool-call approval prompts fire inline in the conversation flow, blocking the host until resolved (60s auto-deny).

Slash commands unified into one namespace. coclaude commands (`/grant`, `/revoke`, `/kick`, `/regen`, `/who`, `/pass`) are intercepted by coclaude before reaching the SDK. Collisions with user-defined skill slash commands are won by coclaude with a startup warning.

### 14. Auth & identity → **Shared session token + per-join host approval**

The session has a single shared token, printed at startup, embedded in the join URL. The host can `/regen` to mint a new token (existing connections survive). Token bearers can *attempt* to connect; the actual admission is a yes/no decision by the host:

```
┌─ join request ────────────────────────────────────────┐
│ "bob" wants to join from 198.51.100.5                 │
│ Scope: readonly (default)                             │
│ [a]pprove  [d]eny  [s]cope >  [r]emember              │
└────────────────────────────────────────────────────────┘
```

Approved connections get a client-side connection-id stored in `~/.coclaude/identity.json`. Reconnects from that connection-id skip re-approval. `/kick <name>` closes a connection and blocklists it for the session.

The host's name comes from `--name <name>` flag or git config `user.name` as default. The host doesn't approve themselves.

### 15. Distribution → **Single binary (Bun-compiled) + secondary npm publish**

Primary: cross-compiled binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, distributed via GitHub Releases. Self-update via the Releases API (`coclaude self-update`). Install script (`curl … | sh`) on the README.

Secondary: `npx coclaude` works for try-without-install discoverability.

Code signing is deferred to ~v1.0. v0.x README documents the macOS Gatekeeper workaround (`xattr -d com.apple.quarantine ./coclaude`).

## Pre-flight verification

Before starting Milestone 1:

1. **Claude Code SDK feature audit.** Confirm the published SDK exposes:
   - Streaming tool calls as structured events
   - Tool-approval hooks (intercept before execution)
   - `AbortSignal` per request (for interrupts)
   - Session resumption by ID
   - Loading the user's `~/.claude/` configuration (CLAUDE.md, settings.json, agents, skills, MCP, hooks)
   - Slash command interception
   
   If any of these are missing, evaluate the Q3 fallback (virtual terminal) or rescope.

2. **`bun build --compile` viability spike.** Produce a hello-world binary for all four targets including a transitive SDK import and an `ink` render. Roughly a day.

## Milestone plan (~2 weeks to v1)

### Pre-flight (1–2 days, before Milestone 1)

- SDK feature audit + Bun compile spike (above)
- Project scaffolding: `package.json`, `tsconfig.json`, Bun runtime, lint, CI skeleton, GitHub Actions for build

### Milestone 1 — Solo coclaude (Days 1–2)

`coclaude host` starts an SDK-driven Claude Code session and renders a coclaude TUI in the host's terminal. No networking yet. Feels like Claude Code: scrolling history, compose pane, inline tool calls, slash commands flowing through. Loads the host's Claude Code config. Persists events to disk as the session progresses.

**Acceptance:** A user can use `coclaude host` for an hour of solo Claude Code work and not notice it isn't `claude` (aside from the empty status bar showing "no one connected" and an absent join URL).

### Milestone 2 — Wire protocol + first join (Days 3–4)

Add the WebSocket server, the join handshake (token + name + per-join approval prompt), the structured event protocol with `seq` numbers, and a `coclaude join <url>` client that renders the same TUI. Joiner sees `[alice]` prefix on host turns; can submit their own which appear as `[bob]`. Author tagging in the system prompt. No scope policy yet — joiners can do anything the host can.

**Acceptance:** Two terminals, two devs, one Claude session. Both can submit prompts; Claude addresses them by name. Per-join approval prompt fires on the host's TUI.

### Milestone 3 — Scopes + approval policy (Days 5–7)

Implement the four scopes. Wire up per-tool-call approval gating for non-host authors. `/grant`, `/revoke`, `/kick`, `/regen` slash commands. Audit log written to disk. Per-call approval prompt with 60s auto-deny. Host-authored tool calls bypass the gate (governed by host's `settings.json`).

**Acceptance:** A `readonly` joiner can submit a prompt that gets Claude to grep the codebase — no host approval needed. The same joiner asking Claude to `npm install` triggers a host approval prompt. Promoting them to `bash` makes `npm install` auto-approve.

### Milestone 4 — Turn-taking, interrupt, ring buffer, reconnect (Days 8–10)

FIFO queue for concurrent submissions. Structured `interrupt` event aborts the in-flight SDK call and inserts the `[interrupted by …]` marker. Ring buffer (last ~500 events) for late-joiner replay; `?since=<seq>` for reconnect. `coclaude host --resume <session-id>` rebuilds state from the on-disk log. Presence in the status bar. Optional `--driver-lock` mode.

**Acceptance:** Alice and Bob each submit a prompt within a second; both run in order; Bob's is queued. Bob can interrupt Alice's in-flight response. Charlie joins 5 minutes in and sees the last few turns. Alice's wifi drops and reconnects; she resumes seamlessly without re-approval.

### Milestone 5 — Tunneling, binary, self-update, README (Days 11–14)

`--tunnel` spawns `cloudflared` and inlines the public URL into the printed join command. Bun-compile pipeline in CI for all four targets. GitHub Releases automation. Self-update flow (`coclaude self-update`). Install script (`curl … | sh`). README polish. npm publish as a secondary path. Final security pass and documented threat model.

**Acceptance:** A developer who has never seen this project can run `curl … | sh && coclaude host --tunnel`, share the URL in Slack, and collaborate within 60 seconds.

## Deferred to v1.1+

- Plan-mode batch approval (Q9 Option F)
- Multi-session multiplexing per host process (Q7 Option C)
- Web/native frontends on the wire protocol (Q13 Option D direction)
- Side chat channel humans can use that Claude doesn't see
- Transcript export with author attribution (one Markdown file per session)
- Second-pair-of-eyes approval mode for dangerous tool calls
- Code signing for macOS/Windows binaries
- Recording / replay of sessions for review
- Per-joiner API cost quotas
- Hosted relay (Q11 Option D)

## Open questions to resolve during implementation

- Exact SDK API surface for loading the host's `~/.claude/` configuration
- Final event-type taxonomy in the wire protocol (the design above sketches it but the field-by-field schema isn't pinned yet)
- TUI keybindings — match Claude Code or pick coclaude-specific?
- Token rotation UX when `/regen` fires mid-session (do existing tokens grace-period, or revoke immediately?)
- Whether to expose a JSON-line stdio mode for the protocol in v1 (groundwork for future headless frontends)

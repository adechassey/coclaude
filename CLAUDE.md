# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`coclaude` is a multiplayer Claude Code application. The host process owns an SDK-driven Claude Code session and exposes a WebSocket server; joiners connect over WS and see / contribute to the same conversation. Design rationale (15 decisions, with the "why" behind each) lives in [PLAN.md](./PLAN.md) — read it before architectural changes.

## Commands

```bash
pnpm dev <subcommand>     # tsx src/cli.ts — e.g. pnpm dev host
pnpm typecheck            # the only correctness gate; no test runner yet
pnpm build                # tsc -p . + chmod +x → ./dist/cli.js
```

Node 22+. Use `pnpm` (declared `packageManager`). No linter beyond `tsc --noEmit`. Cutting a release: invoke `/release` (skill at `.claude/skills/release/`) — don't tag manually, the skill encodes preflight checks you'll miss.

## Where to start reading

For a quick map: `src/session/SessionView.ts` (the interface — ~50 lines, cleanest summary of runtime surface), then `src/session/Session.ts` (the host's implementation, ~800 lines, the heart of the project), then `src/wire/server.ts` (the WS bridge).

## Architecture

**One app, two roles, one TUI.** `src/tui/App.tsx` takes a `SessionView` and renders identically for host and every joiner. Two implementations: `Session` (host, owns the SDK call + state) and `RemoteSession` (joiner, mirrors host state via WS). Add a method to `SessionView` → both implementations satisfy it, and a wire message may need adding.

**One event format, three destinations.** `Session.emit()` is the single fan-out point. A `CoEvent` (union in `src/types.ts`) flows to: the on-disk JSONL log at `~/.coclaude/sessions/<id>.jsonl`, the in-memory ring (capped at 500), and all subscribed listeners — including the wire forwarder which sends them to joiners. Same format everywhere is load-bearing; don't introduce a separate "wire log" or "audit log" format. Subscribers attach via `on()` (replays the ring on subscribe) or `onFuture()` (no replay) — the wire forwarder MUST use `onFuture()` because joiners already get the snapshot in `welcome`.

**Persistent vs transient.** Streaming text deltas (`setStreaming`) and tool-progress ticks (`notifyToolProgress`) fire many times per second and bypass `emit()` — they flow only to dedicated listener sets and dedicated wire messages (`stream`, `tool_progress`). New tick-rate events follow the same pattern, not in `CoEvent`.

**Scope-gated tool calls.** The `canUseTool` callback in `Session.run()` is the security boundary. It uses `this.currentAuthor` (set when `userStream()` yields a queued prompt) and `isInScope(toolName, scope)` from `src/policy/scopes.ts`. Host turns bypass; in-scope joiner calls auto-approve; out-of-scope publish a `ToolApprovalRequest` to the host's TUI with 60s auto-deny. New tools → add to `TOOL_MIN_SCOPE`; MCP defaults to `bash`, unknown tools fail-secure to `unrestricted`.

**Slash commands.** `Session.submitPrompt()` intercepts `/`-prefixed input matching `COCLAUDE_COMMAND_NAMES` (`src/policy/slashCommands.ts`) — our commands (`/grant`, `/revoke`, `/kick`, `/who`) handled locally; everything else passes through to the SDK. The picker UI prepends `COCLAUDE_COMMANDS` to the SDK's list.

**Interrupt + resume loop.** `Session.run()` is a `while (!this.closed)` loop. Each iteration creates a fresh SDK `query()` with its own `AbortController`. `Session.interrupt()` aborts; the catch detects the flag, emits an `interrupted` event, and loops with `resume: sessionId` — the SDK reattaches to the same conversation. Same loop handles `coclaude host --resume <id>`.

**Bun-compile gotcha (production).** `bun build --compile` can't bundle the Claude Agent SDK's platform-specific native CLI (optional npm deps), so `src/findClaude.ts` locates the user's `claude` binary on PATH at runtime and `Session.run()` passes it via `pathToClaudeCodeExecutable`. The compiled binary distribution therefore requires `claude` installed; the `npm i -g` path doesn't (optional deps resolve normally there).

**Version stamping.** `src/version.ts` exports `VERSION` as a literal. CI overwrites it before `bun build --compile` so binaries report the tagged version. `package.json` `version` and `src/version.ts` `VERSION` must stay in sync — the `/release` skill bumps both.

## Release flow

Tag push (`v*`) triggers `.github/workflows/release.yml`: typecheck → stamp `src/version.ts` → cross-compile binaries (darwin-arm64/x64, linux-arm64/x64, windows-x64) → publish GH Release → `pnpm publish` via npm OIDC. Pre-release tags (containing `-`) skip npm publish.

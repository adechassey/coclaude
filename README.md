# coclaude

[![npm version](https://img.shields.io/npm/v/coclaude.svg)](https://www.npmjs.com/package/coclaude)
[![license](https://img.shields.io/npm/l/coclaude.svg)](./LICENSE)

Multiplayer Claude Code. Pair-program with teammates inside the same Claude Code session.

## What it is

`coclaude` is a Claude Code application built on the Claude Code SDK with a multiplayer surface bolted on. The host runs `coclaude host`, which starts a Claude Code session and opens a WebSocket port. Other developers run `coclaude join <url>` to attach.

Every participant — host included — has their own local compose pane and submits *complete prompts* as discrete, author-tagged structured events. Claude sees `[alice] refactor the auth module` and `[bob] add tests for the helper`. No keystroke collisions, attribution is native to the transcript, turn-taking is enforced by the protocol (FIFO queue + explicit interrupt).

## Why

Today, AI-assisted coding is single-player. Two devs working with Claude together end up screen-sharing while one types. That works for demos but breaks down for real collaboration:

- **No attribution.** Claude can't tell who said what.
- **No turn-taking.** Two people typing into the same prompt is chaos.
- **No async.** Teammates can't drop in to see what's already happening.
- **No safety.** Whoever has the keyboard has shell access via Claude's tools.

`coclaude` treats multiplayer as the protocol-level concern it actually is, not as a sharing problem.

## How it works (at a glance)

- **Each participant has a local compose pane.** Drafts are private. Only submitted prompts go on the wire.
- **Submitted prompts are author-tagged structured events**, not raw keystrokes. Claude addresses authors by name.
- **FIFO queue + explicit interrupt.** Anyone can submit any time. Concurrent submissions queue. An `interrupt` event aborts the in-flight response and inserts a structured marker in history.
- **Scoped approvals for non-host authors.** Joiners are admitted with a scope: `readonly`, `edits`, `bash`, or `unrestricted` (default `readonly`). Tool calls inside scope auto-approve; outside-scope tool calls trigger a prompt on the host's TUI with a 60s auto-deny.
- **Host approves every join.** The session has a shared token, but admission is a yes/no decision by the host (`[a]pprove / [d]eny / [s]cope / [r]emember`).
- **Resumable sessions.** The disk-persisted event log is also the on-wire format and the audit trail. `coclaude host --resume <session-id>` picks up where you left off.
- **Live streaming.** Claude's text streams in as it's generated; in-flight tool calls tick with elapsed time; tool results show a preview.

## Status

Early alpha. Solo + 2–3 person collaboration works. Published on [npm](https://www.npmjs.com/package/coclaude) and as cross-platform binaries on the [Releases](https://github.com/adechassey/coclaude/releases) page. See [PLAN.md](./PLAN.md) for the design and the milestone status.

What's working today:

- Host an SDK-driven Claude Code session with a coclaude TUI
- Join from another terminal over loopback or any tunnel of your choice
- Per-join host approval, scoped tool-call approval for joiners
- `/grant`, `/revoke`, `/kick`, `/who` slash commands
- FIFO queue, interrupts (Esc), session resume from disk log
- `--tunnel` (cloudflared quick tunnel for cross-network joiners)
- Streaming text, tool progress, multi-line input, prompt history

Not yet:

- Auto-reconnect on dropped joiner connection
- Web/native clients (wire protocol is ready; no client built yet)

## Requirements

- **Node.js 22+** (for the npm install path).
- **The `claude` CLI** must be installed and on your PATH. coclaude orchestrates a Claude Code session and reuses your existing Claude Code auth / settings / agents / hooks. Install via the [Claude Code docs](https://docs.claude.com/en/docs/claude-code/setup) if you haven't already.

## Install

Primary (npm):

```bash
npm install -g coclaude    # or: pnpm i -g coclaude
```

Secondary (single binary via curl):

```bash
curl -fsSL https://raw.githubusercontent.com/adechassey/coclaude/main/install.sh | bash
```

The binary path is heavier (~70MB; bundles the Bun runtime) but doesn't require Node. **Both paths still need `claude` on PATH** — see Requirements.

From source:

```bash
git clone git@github.com:adechassey/coclaude.git
cd coclaude
pnpm install
pnpm dev host           # run via tsx
# or: pnpm build && ./dist/cli.js host
```

## Usage

```bash
# Host a session — feels like Claude Code with a status bar
coclaude host

# Host and bind to your tailnet IP so teammates can connect
coclaude host --bind 100.x.x.x

# Host and expose publicly via cloudflared (requires `cloudflared` on PATH)
coclaude host --tunnel

# Use a fixed port
coclaude host --port 7777

# Resume yesterday's session
coclaude host --resume <session-id>

# Join a session
coclaude join ws://host:port/s/<token>
coclaude join --name bob ws://host:port/s/<token>

# Update to the latest binary release (when installed via curl|sh)
coclaude self-update
```

The host's status bar prints the join URL on startup. Pass it to teammates.

### Host slash commands

| Command | What it does |
|---|---|
| `/grant <name> <scope>` | Promote a participant. Scopes: `readonly`, `edits`, `bash`, `unrestricted`. |
| `/revoke <name>` | Demote a participant back to `readonly`. |
| `/kick <name>` | Disconnect a participant. |
| `/who` | List host + all participants and their current scopes. |

Anything else starting with `/` is a Claude Code slash command and is passed through to the SDK.

### Key bindings

| Key | Action |
|---|---|
| Enter | Submit prompt |
| Ctrl+J | Insert newline (multi-line prompt) |
| Esc | Interrupt the in-flight Claude turn |
| ↑ / ↓ | Cycle through your prompt history (when the slash picker is closed) |
| Tab | Autocomplete the highlighted slash command |
| Ctrl+C | Exit |

## Security model

Joining a `coclaude` session means Claude can run tools on the host's machine on your behalf. We take this seriously:

- Default-deny: every joiner starts in `readonly` scope; promotion is explicit and per-joiner.
- Host approves every join, not just every token bearer.
- Every tool call is logged with the requesting author's name (in `~/.coclaude/sessions/<id>.jsonl`).
- The host's `settings.json` allow-lists apply only to host-authored turns, never to joiners.
- Loopback bind by default — network exposure requires explicit `--bind` or `--tunnel`.

Even so: **do not host a `coclaude` session for people you would not give SSH access to.** A trusted joiner promoted to `unrestricted` scope is functionally an SSH session.

## Architecture

coclaude is a Claude Code SDK application, not a PTY wrapper around the `claude` CLI. The host process runs the SDK directly, owns the session state, and exposes a WebSocket server. All participants (including the host's own TUI) connect to that server and exchange structured events.

This means:

- coclaude inherits the host's Claude Code configuration (auth, CLAUDE.md, agents, skills, MCP servers, hooks, settings) and applies it transparently — but with author-aware approval gating on every shell-touching path.
- The on-wire event log and the on-disk session log are the same format. Audit, replay, transcript export, and session resume share one code path.
- Each client renders its own TUI (`ink`-based) from the structured event stream. No terminal-multiplexing of byte streams.

For the full design and milestone plan, see [PLAN.md](./PLAN.md).

## License

MIT — see [LICENSE](./LICENSE).

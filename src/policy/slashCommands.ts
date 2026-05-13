import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";

// Coclaude's own commands, intercepted by Session.submitPrompt before the
// prompt is forwarded to the SDK. Names live in the same flat namespace as
// Claude Code's commands — collisions are won by coclaude with a startup
// warning.
export const COCLAUDE_COMMANDS: SlashCommand[] = [
  {
    name: "grant",
    description: "Grant a participant a scope",
    argumentHint: "<name> <readonly|edits|bash|unrestricted>",
  },
  {
    name: "revoke",
    description: "Revoke a participant back to readonly",
    argumentHint: "<name>",
  },
  {
    name: "kick",
    description: "Disconnect a participant",
    argumentHint: "<name>",
  },
  {
    name: "who",
    description: "List connected participants and their scopes",
    argumentHint: "",
  },
];

export const COCLAUDE_COMMAND_NAMES: ReadonlySet<string> = new Set(
  COCLAUDE_COMMANDS.map((c) => c.name),
);

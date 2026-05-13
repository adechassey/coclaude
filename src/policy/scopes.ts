// Per-joiner authorization scopes. The host's own tool calls bypass this
// entirely (governed by their settings.json). Joiners start at readonly and
// are promoted explicitly by the host via /grant.

export type Scope = "readonly" | "edits" | "bash" | "unrestricted";

export const SCOPE_VALUES: readonly Scope[] = [
  "readonly",
  "edits",
  "bash",
  "unrestricted",
];

export const DEFAULT_SCOPE: Scope = "readonly";

const SCOPE_LEVEL: Record<Scope, number> = {
  readonly: 0,
  edits: 1,
  bash: 2,
  unrestricted: 3,
};

// Minimum scope required to invoke a given tool.
const TOOL_MIN_SCOPE: Record<string, Scope> = {
  Read: "readonly",
  Glob: "readonly",
  Grep: "readonly",
  WebSearch: "readonly",
  WebFetch: "readonly",
  BashOutput: "readonly",
  TodoWrite: "readonly",
  Edit: "edits",
  Write: "edits",
  MultiEdit: "edits",
  NotebookEdit: "edits",
  Bash: "bash",
  KillShell: "bash",
  Task: "unrestricted",
};

export function isInScope(toolName: string, scope: Scope): boolean {
  let required: Scope;
  if (toolName in TOOL_MIN_SCOPE) {
    required = TOOL_MIN_SCOPE[toolName]!;
  } else if (toolName.startsWith("mcp__")) {
    // MCP tools hit external services with host credentials — treat as bash-tier.
    required = "bash";
  } else {
    // Unknown tool — require unrestricted by default.
    required = "unrestricted";
  }
  return SCOPE_LEVEL[scope] >= SCOPE_LEVEL[required];
}

export function parseScope(s: string): Scope | null {
  const lower = s.toLowerCase();
  return (SCOPE_VALUES as readonly string[]).includes(lower)
    ? (lower as Scope)
    : null;
}

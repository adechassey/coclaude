import { describe, expect, it } from "vitest";
import { isInScope, parseScope, type Scope } from "../../src/policy/scopes.js";

describe("isInScope", () => {
  it("allows read-tier tools at every scope", () => {
    const readTools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "BashOutput", "TodoWrite"];
    const scopes: Scope[] = ["readonly", "edits", "bash", "unrestricted"];
    for (const tool of readTools) {
      for (const scope of scopes) {
        expect(isInScope(tool, scope), `${tool} @ ${scope}`).toBe(true);
      }
    }
  });

  it("denies edit tools to readonly", () => {
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      expect(isInScope(tool, "readonly")).toBe(false);
      expect(isInScope(tool, "edits")).toBe(true);
    }
  });

  it("denies Bash below bash scope", () => {
    expect(isInScope("Bash", "readonly")).toBe(false);
    expect(isInScope("Bash", "edits")).toBe(false);
    expect(isInScope("Bash", "bash")).toBe(true);
    expect(isInScope("Bash", "unrestricted")).toBe(true);
  });

  it("requires unrestricted for Task", () => {
    expect(isInScope("Task", "readonly")).toBe(false);
    expect(isInScope("Task", "edits")).toBe(false);
    expect(isInScope("Task", "bash")).toBe(false);
    expect(isInScope("Task", "unrestricted")).toBe(true);
  });

  it("treats mcp__ tools as bash-tier", () => {
    expect(isInScope("mcp__github__create_pr", "readonly")).toBe(false);
    expect(isInScope("mcp__github__create_pr", "edits")).toBe(false);
    expect(isInScope("mcp__github__create_pr", "bash")).toBe(true);
    expect(isInScope("mcp__anything__here", "unrestricted")).toBe(true);
  });

  it("fail-secures unknown tools to unrestricted", () => {
    expect(isInScope("CustomTool", "readonly")).toBe(false);
    expect(isInScope("CustomTool", "bash")).toBe(false);
    expect(isInScope("CustomTool", "unrestricted")).toBe(true);
  });
});

describe("parseScope", () => {
  it("accepts canonical scope names case-insensitively", () => {
    expect(parseScope("readonly")).toBe("readonly");
    expect(parseScope("EDITS")).toBe("edits");
    expect(parseScope("Bash")).toBe("bash");
    expect(parseScope("unrestricted")).toBe("unrestricted");
  });

  it("rejects unknown scopes", () => {
    expect(parseScope("admin")).toBeNull();
    expect(parseScope("")).toBeNull();
    expect(parseScope("readonly ")).toBeNull();
  });
});

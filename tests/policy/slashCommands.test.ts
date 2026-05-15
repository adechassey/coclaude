import { describe, expect, it } from "vitest";
import {
  COCLAUDE_COMMAND_NAMES,
  COCLAUDE_COMMANDS,
} from "../../src/policy/slashCommands.js";

describe("COCLAUDE_COMMANDS / COCLAUDE_COMMAND_NAMES", () => {
  it("the name set matches the command list", () => {
    const fromList = new Set(COCLAUDE_COMMANDS.map((c) => c.name));
    expect([...COCLAUDE_COMMAND_NAMES].sort()).toEqual([...fromList].sort());
  });

  it("includes the four documented commands", () => {
    expect(COCLAUDE_COMMAND_NAMES.has("grant")).toBe(true);
    expect(COCLAUDE_COMMAND_NAMES.has("revoke")).toBe(true);
    expect(COCLAUDE_COMMAND_NAMES.has("kick")).toBe(true);
    expect(COCLAUDE_COMMAND_NAMES.has("who")).toBe(true);
  });

  it("each command has a non-empty description", () => {
    for (const c of COCLAUDE_COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

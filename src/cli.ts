#!/usr/bin/env node
import { Command } from "commander";
import { startHost } from "./host.js";

const program = new Command();

program
  .name("coclaude")
  .description("Multiplayer Claude Code")
  .version("0.0.1");

program
  .command("host")
  .description("Start a coclaude session")
  .option("--name <name>", "Your display name")
  .option("--resume <session-id>", "Resume a previous session by id")
  .action(async (opts: { name?: string; resume?: string }) => {
    await startHost({ name: opts.name, resume: opts.resume });
  });

program
  .command("join <url>")
  .description("Join a coclaude session (not yet implemented)")
  .action(() => {
    console.error("join not implemented yet — see Milestone 2 in PLAN.md");
    process.exit(1);
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { Command } from "commander";
import { startHost } from "./host.js";
import { startJoin } from "./join.js";

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
  .option("--bind <host>", "Interface to bind the WS server to", "127.0.0.1")
  .option("--port <port>", "Port to bind (0 = random)", (v) => parseInt(v, 10))
  .option(
    "--tunnel",
    "Expose the session publicly via cloudflared (requires cloudflared installed)",
  )
  .action(
    async (opts: {
      name?: string;
      resume?: string;
      bind?: string;
      port?: number;
      tunnel?: boolean;
    }) => {
      await startHost({
        ...(opts.name ? { name: opts.name } : {}),
        ...(opts.resume ? { resume: opts.resume } : {}),
        ...(opts.bind ? { bind: opts.bind } : {}),
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        ...(opts.tunnel ? { tunnel: true } : {}),
      });
    },
  );

program
  .command("join <url>")
  .description("Join a coclaude session at the given ws:// URL")
  .option("--name <name>", "Your display name")
  .action(async (url: string, opts: { name?: string }) => {
    await startJoin({ url, ...(opts.name ? { name: opts.name } : {}) });
  });

program.parseAsync().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

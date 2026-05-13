import React from "react";
import { render } from "ink";
import { Session } from "./session/Session.js";
import { App } from "./tui/App.js";
import { resolveHostName } from "./identity.js";
import { startServer } from "./wire/server.js";
import { generateToken } from "./wire/token.js";

export interface HostOptions {
  name?: string;
  resume?: string;
  bind?: string;
  port?: number;
}

export async function startHost(opts: HostOptions = {}): Promise<void> {
  const hostName = opts.name ?? (await resolveHostName());
  const session = new Session({
    hostName,
    ...(opts.resume ? { resumeSessionId: opts.resume } : {}),
  });

  // Start the WS server before the TUI takes over the terminal — that way
  // any "address in use" / "permission denied" error is readable on stderr.
  const token = generateToken();
  const server = await startServer({
    session,
    token,
    host: opts.bind ?? "127.0.0.1",
    port: opts.port ?? 0,
  });

  // Kick off the SDK event loop; errors are surfaced via system events.
  const runPromise = session.run().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[session]", err);
  });

  const { waitUntilExit } = render(
    React.createElement(App, { session, joinUrl: server.url }),
  );
  try {
    await waitUntilExit();
  } finally {
    await session.stop();
    await server.close();
    await runPromise;
  }
}

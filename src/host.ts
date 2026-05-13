import React from "react";
import { render } from "ink";
import { Session } from "./session/Session.js";
import { App } from "./tui/App.js";
import { resolveHostName } from "./identity.js";

export interface HostOptions {
  name?: string;
  resume?: string;
}

export async function startHost(opts: HostOptions = {}): Promise<void> {
  const hostName = opts.name ?? (await resolveHostName());
  const session = new Session({
    hostName,
    ...(opts.resume ? { resumeSessionId: opts.resume } : {}),
  });

  // Kick off the SDK event loop. We don't await it here — it runs alongside the
  // TUI render until the user exits and we call session.stop() below.
  const runPromise = session.run().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[session]", err);
  });

  const { waitUntilExit } = render(React.createElement(App, { session }));
  await waitUntilExit();
  await session.stop();
  await runPromise;
}

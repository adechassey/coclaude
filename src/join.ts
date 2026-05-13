import React from "react";
import { render } from "ink";
import { App } from "./tui/App.js";
import { RemoteSession } from "./session/RemoteSession.js";
import { resolveHostName } from "./identity.js";

export interface JoinOptions {
  url: string;
  name?: string;
}

export async function startJoin(opts: JoinOptions): Promise<void> {
  const name = opts.name ?? (await resolveHostName());
  let exited = false;
  const session = new RemoteSession({
    url: opts.url,
    name,
    onDenied: (reason) => {
      if (!exited) {
        // eslint-disable-next-line no-console
        console.error(`join denied: ${reason}`);
        process.exit(1);
      }
    },
    onClose: (reason) => {
      if (!exited) {
        // eslint-disable-next-line no-console
        console.error(`connection closed: ${reason}`);
        process.exit(1);
      }
    },
  });

  const { waitUntilExit } = render(React.createElement(App, { session }));
  try {
    await waitUntilExit();
  } finally {
    exited = true;
    session.close();
  }
}

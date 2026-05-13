import React from "react";
import { render } from "ink";
import { Session } from "./session/Session.js";
import { App } from "./tui/App.js";
import { resolveHostName } from "./identity.js";
import { startServer } from "./wire/server.js";
import { generateToken } from "./wire/token.js";
import {
  startCloudflaredTunnel,
  tunnelJoinUrl,
  TunnelStartError,
  type Tunnel,
} from "./wire/tunnel.js";

export interface HostOptions {
  name?: string;
  resume?: string;
  bind?: string;
  port?: number;
  token?: string;
  tunnel?: boolean;
}

export async function startHost(opts: HostOptions = {}): Promise<void> {
  const hostName = opts.name ?? (await resolveHostName());
  const session = new Session({
    hostName,
    ...(opts.resume ? { resumeSessionId: opts.resume } : {}),
  });

  const token = opts.token ?? generateToken();
  const server = await startServer({
    session,
    token,
    host: opts.bind ?? "127.0.0.1",
    port: opts.port ?? 0,
  });

  let tunnel: Tunnel | null = null;
  let joinUrl = server.url;
  if (opts.tunnel) {
    process.stderr.write("starting cloudflared tunnel…\n");
    try {
      tunnel = await startCloudflaredTunnel(server.port);
      joinUrl = tunnelJoinUrl(tunnel.publicUrl, token);
    } catch (err: unknown) {
      await server.close();
      if (err instanceof TunnelStartError) {
        process.stderr.write(`error: ${err.message}\n`);
        if (err.hint) process.stderr.write(`hint:  ${err.hint}\n`);
      } else {
        process.stderr.write(`tunnel error: ${(err as Error)?.message ?? err}\n`);
      }
      process.exit(1);
    }
  }

  const runPromise = session.run().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[session]", err);
  });

  const { waitUntilExit } = render(
    React.createElement(App, { session, joinUrl }),
  );
  try {
    await waitUntilExit();
  } finally {
    await session.stop();
    await server.close();
    if (tunnel) await tunnel.close();
    await runPromise;
  }
}

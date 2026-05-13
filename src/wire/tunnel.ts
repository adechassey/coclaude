import { spawn, type ChildProcess } from "node:child_process";

export interface Tunnel {
  /** Public https:// URL pointing at the locally-bound WS server. */
  publicUrl: string;
  close(): Promise<void>;
}

export class TunnelStartError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

/**
 * Start a cloudflared "quick tunnel" against the given local port. Returns
 * once cloudflared has reported the public URL. The tunnel stays alive
 * until close() is called.
 *
 * Requires `cloudflared` on the user's PATH. We use the free quick-tunnel
 * mode (no Cloudflare account needed).
 */
export async function startCloudflaredTunnel(
  localPort: number,
  timeoutMs = 30_000,
): Promise<Tunnel> {
  let proc: ChildProcess;
  try {
    proc = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", `http://localhost:${localPort}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err: unknown) {
    throw new TunnelStartError(
      `failed to spawn cloudflared: ${(err as Error)?.message ?? err}`,
      "install with: brew install cloudflared  (see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)",
    );
  }

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new TunnelStartError(
            `cloudflared did not report a tunnel URL within ${Math.round(
              timeoutMs / 1000,
            )}s`,
          ),
        ),
      );
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      const match = chunk
        .toString()
        .match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        settle(() => resolve(match[0]));
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("error", (err) => {
      const e = err as NodeJS.ErrnoException;
      clearTimeout(timer);
      if (e.code === "ENOENT") {
        settle(() =>
          reject(
            new TunnelStartError(
              "cloudflared not found on PATH",
              "install with: brew install cloudflared  (see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)",
            ),
          ),
        );
        return;
      }
      settle(() =>
        reject(new TunnelStartError(`cloudflared error: ${e.message}`)),
      );
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      settle(() =>
        reject(
          new TunnelStartError(
            `cloudflared exited (code ${code}) before reporting a URL`,
          ),
        ),
      );
    });
  });

  return {
    publicUrl: url,
    async close() {
      if (!proc.killed && proc.exitCode === null) {
        proc.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              // ignore
            }
            resolve();
          }, 2_000);
          proc.once("exit", () => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
  };
}

/** Build the wss:// join URL for a given tunnel + session token. */
export function tunnelJoinUrl(publicHttpsUrl: string, token: string): string {
  const wsUrl = publicHttpsUrl.replace(/^https?:/, "wss:");
  return `${wsUrl}/s/${token}`;
}

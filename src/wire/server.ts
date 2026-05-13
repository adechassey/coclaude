import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Session } from "../session/Session.js";
import type { JoinRequest } from "../session/SessionView.js";
import {
  PROTOCOL_VERSION,
  encode,
  decode,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.js";
import { buildJoinUrl } from "./token.js";

export interface ServerOptions {
  session: Session;
  token: string;
  host: string;
  port: number;
}

export interface RunningServer {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { session, token, host, port } = opts;
  const httpServer = http.createServer((req, res) => {
    res.statusCode = 426; // Upgrade Required
    res.setHeader("Content-Type", "text/plain");
    res.end("coclaude — WebSocket only\n");
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const match = url.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
    if (!match || match[1] !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, req.socket.remoteAddress ?? "?", session);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    url: buildJoinUrl(host, boundPort, token),
    host,
    port: boundPort,
    async close() {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function handleConnection(
  ws: WebSocket,
  remoteAddress: string,
  session: Session,
): void {
  const connId = randomUUID();
  let joinerName: string | null = null;
  let approved = false;
  let cleanedUp = false;

  const cleanups: Array<() => void> = [];
  const teardown = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const c of cleanups) {
      try {
        c();
      } catch {
        // ignore
      }
    }
    if (joinerName && approved) {
      session.removeParticipant(joinerName);
    }
  };

  const send = (msg: ServerMessage): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encode(msg));
    }
  };

  const deny = (reason: string): void => {
    send({ type: "denied", reason });
    ws.close(1008, reason);
  };

  ws.on("close", teardown);
  ws.on("error", teardown);

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = decode<ClientMessage>(raw.toString());
    } catch {
      deny("invalid message encoding");
      return;
    }

    if (!approved) {
      if (msg.type !== "hello") {
        deny("expected hello");
        return;
      }
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        deny(
          `protocol version mismatch (server=${PROTOCOL_VERSION}, client=${msg.protocolVersion})`,
        );
        return;
      }
      const requested = msg.name.trim();
      if (!requested) {
        deny("empty name");
        return;
      }
      if (
        session.getParticipants().some((p) => p.name === requested) ||
        requested === session.hostName
      ) {
        deny(`name '${requested}' is already taken`);
        return;
      }

      const req: JoinRequest = {
        id: connId,
        name: requested,
        remoteAddress,
        resolve: (decision, reason) => {
          if (cleanedUp) return;
          if (decision === "approve") {
            approved = true;
            joinerName = requested;
            session.addParticipant(joinerName);
            send({
              type: "welcome",
              sessionId: session.sessionId,
              hostName: session.hostName,
              yourName: joinerName,
              events: session.getEvents(),
              slashCommands: session.getSlashCommands(),
              participants: session.getParticipants(),
            });
            // Subscribe to live updates after the welcome snapshot. Use
            // onFuture so we don't re-deliver events the joiner already has
            // from welcome.
            cleanups.push(
              session.onFuture((event) => send({ type: "event", event })),
            );
            cleanups.push(
              session.onSlashCommands((slashCommands) =>
                send({ type: "commands", slashCommands }),
              ),
            );
            cleanups.push(
              session.onParticipants((participants) =>
                send({ type: "participants", participants }),
              ),
            );
          } else {
            deny(reason ?? "join denied by host");
          }
        },
      };
      session.publishJoinRequest(req);
      return;
    }

    // Approved path
    if (msg.type === "submit") {
      const content = msg.content.trim();
      if (content && joinerName) {
        session.submitPrompt(content, joinerName);
      }
      return;
    }
    if (msg.type === "ping") {
      send({ type: "pong" });
      return;
    }
    // Unknown message types are ignored for forward compatibility.
  });
}

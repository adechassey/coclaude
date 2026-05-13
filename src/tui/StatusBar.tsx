import React from "react";
import { Box, Text } from "ink";
import type { Participant } from "../wire/protocol.js";

interface Props {
  hostName: string;
  myName: string;
  isHost: boolean;
  sessionId: string;
  thinking: boolean;
  participants: Participant[];
  queueDepth: number;
  joinUrl?: string;
  lastCostUsd?: number;
}

export const StatusBar: React.FC<Props> = ({
  hostName,
  myName,
  isHost,
  sessionId,
  thinking,
  participants,
  queueDepth,
  joinUrl,
  lastCostUsd,
}) => {
  // Show everyone connected from the *viewer's* perspective — i.e. exclude
  // self, and for guests include the host (who isn't in `participants`).
  const connectedNames: string[] = isHost
    ? participants.map((p) => p.name)
    : [
        `${hostName} (host)`,
        ...participants
          .filter((p) => p.name !== myName)
          .map((p) => p.name),
      ];
  const conn =
    connectedNames.length === 0
      ? "solo"
      : `${connectedNames.length} connected: ${connectedNames.join(", ")}`;
  const status = thinking ? "thinking…" : "ready";
  const role = isHost ? "host" : "guest";
  return (
    <Box paddingX={1} flexDirection="column">
      <Box>
        <Text bold>coclaude </Text>
        <Text color="cyan">
          • {myName} ({role}){" "}
        </Text>
        <Text dimColor>• {conn} </Text>
        <Text dimColor>• {status} </Text>
        {queueDepth > 0 && (
          <Text color="yellow">• queue: {queueDepth} </Text>
        )}
        <Text dimColor>• session {sessionId.slice(0, 8)}</Text>
        {lastCostUsd !== undefined && (
          <Text dimColor> • ${lastCostUsd.toFixed(4)}</Text>
        )}
      </Box>
      {joinUrl && (
        <Box>
          <Text dimColor>join: {joinUrl}</Text>
        </Box>
      )}
    </Box>
  );
};

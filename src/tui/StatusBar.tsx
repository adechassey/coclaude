import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { Participant } from "../wire/protocol.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Props {
  hostName: string;
  myName: string;
  isHost: boolean;
  sessionId: string;
  thinking: boolean;
  participants: Participant[];
  queueDepth: number;
  totalCostUsd: number;
  joinUrl?: string;
}

export const StatusBar: React.FC<Props> = ({
  hostName,
  myName,
  isHost,
  sessionId,
  thinking,
  participants,
  queueDepth,
  totalCostUsd,
  joinUrl,
}) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [thinking]);

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
  const role = isHost ? "host" : "guest";

  return (
    <Box paddingX={1} flexDirection="column">
      <Box>
        <Text bold>coclaude </Text>
        <Text color="cyan">
          • {myName} ({role}){" "}
        </Text>
        <Text dimColor>• {conn} </Text>
        <Text color={thinking ? "yellow" : undefined} dimColor={!thinking}>
          • {thinking ? `${SPINNER_FRAMES[frame]} thinking` : "ready"}{" "}
        </Text>
        {queueDepth > 0 && (
          <Text color="yellow">• queue: {queueDepth} </Text>
        )}
        <Text dimColor>• session {sessionId.slice(0, 8)}</Text>
        {totalCostUsd > 0 && (
          <Text dimColor> • ${totalCostUsd.toFixed(4)}</Text>
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

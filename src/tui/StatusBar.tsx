import React from "react";
import { Box, Text } from "ink";

interface Props {
  hostName: string;
  sessionId: string;
  thinking: boolean;
  connected: number;
  lastCostUsd?: number;
}

export const StatusBar: React.FC<Props> = ({
  hostName,
  sessionId,
  thinking,
  connected,
  lastCostUsd,
}) => {
  const conn = connected === 0 ? "solo" : `${connected} connected`;
  const status = thinking ? "thinking…" : "ready";
  return (
    <Box paddingX={1}>
      <Text bold>coclaude </Text>
      <Text color="cyan">• {hostName} (host) </Text>
      <Text dimColor>• {conn} </Text>
      <Text dimColor>• {status} </Text>
      <Text dimColor>• session {sessionId.slice(0, 8)}</Text>
      {lastCostUsd !== undefined && (
        <Text dimColor> • ${lastCostUsd.toFixed(4)}</Text>
      )}
    </Box>
  );
};

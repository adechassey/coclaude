import React from "react";
import { Box, Text } from "ink";
import type { CoEvent } from "../types.js";

interface Props {
  events: CoEvent[];
  showAuthorPrefix: boolean;
}

export const Conversation: React.FC<Props> = ({ events, showAuthorPrefix }) => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {events.map((e) => (
        <EventLine key={e.seq} event={e} showAuthorPrefix={showAuthorPrefix} />
      ))}
    </Box>
  );
};

const EventLine: React.FC<{
  event: CoEvent;
  showAuthorPrefix: boolean;
}> = ({ event, showAuthorPrefix }) => {
  switch (event.type) {
    case "user_prompt":
      return (
        <Box>
          {showAuthorPrefix && (
            <Text color="cyan">[{event.author}] </Text>
          )}
          <Text>{event.content}</Text>
        </Box>
      );
    case "assistant_message":
      return (
        <Box>
          <Text color="yellow">claude </Text>
          <Text>{event.content}</Text>
        </Box>
      );
    case "tool_call": {
      const inputStr = JSON.stringify(event.input);
      const preview = inputStr.length > 80 ? inputStr.slice(0, 77) + "…" : inputStr;
      return (
        <Box>
          <Text dimColor>↪ {event.toolName}({preview})</Text>
        </Box>
      );
    }
    case "tool_result":
      return null;
    case "result":
      return (
        <Box>
          <Text dimColor>
            · {event.subtype === "success" ? "done" : event.subtype} ·{" "}
            {event.numTurns} turn{event.numTurns === 1 ? "" : "s"} · $
            {event.totalCostUsd.toFixed(4)}
          </Text>
        </Box>
      );
    case "system":
      return null;
  }
};

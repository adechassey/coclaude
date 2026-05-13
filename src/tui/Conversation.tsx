import React from "react";
import { Box, Text } from "ink";
import type { CoEvent } from "../types.js";

interface Props {
  events: CoEvent[];
  showAuthorPrefix: boolean;
  myName: string;
}

export const Conversation: React.FC<Props> = ({
  events,
  showAuthorPrefix,
  myName,
}) => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {events.map((e) => (
        <EventLine
          key={e.seq}
          event={e}
          showAuthorPrefix={showAuthorPrefix}
          myName={myName}
        />
      ))}
    </Box>
  );
};

const EventLine: React.FC<{
  event: CoEvent;
  showAuthorPrefix: boolean;
  myName: string;
}> = ({ event, showAuthorPrefix, myName }) => {
  switch (event.type) {
    case "user_prompt": {
      const mine = event.author === myName;
      return (
        <Box>
          {showAuthorPrefix && (
            <Text color={mine ? "cyan" : "magenta"} bold={mine}>
              [{event.author}]{" "}
            </Text>
          )}
          <Text>{event.content}</Text>
        </Box>
      );
    }
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
    case "interrupted":
      return (
        <Box>
          <Text color="yellow">
            ⏸ interrupted by {event.by}
            {event.reason ? `: ${event.reason}` : ""}
          </Text>
        </Box>
      );
    case "system":
      return renderSystem(event);
  }
};

function renderSystem(
  event: Extract<CoEvent, { type: "system" }>,
): React.ReactElement | null {
  const payload = event.payload as Record<string, unknown> | undefined;
  switch (event.subtype) {
    case "scope_changed":
      return (
        <Box>
          <Text dimColor>
            · {String(payload?.["by"])} set {String(payload?.["name"])}'s scope
            to {String(payload?.["scope"])}
          </Text>
        </Box>
      );
    case "kicked":
      return (
        <Box>
          <Text dimColor>
            · {String(payload?.["by"])} kicked {String(payload?.["name"])}
          </Text>
        </Box>
      );
    case "tool_denied":
      return (
        <Box>
          <Text color="red">
            ✗ denied {String(payload?.["author"])}'s {String(payload?.["toolName"])}{" "}
            {payload?.["reason"] ? `(${String(payload["reason"])})` : ""}
          </Text>
        </Box>
      );
    case "command_error":
      return (
        <Box>
          <Text color="red">⚠ {String(payload?.["message"])}</Text>
        </Box>
      );
    case "who": {
      const rows = (payload?.["rows"] as Array<{
        name: string;
        scope: string;
      }>) ?? [];
      return (
        <Box flexDirection="column">
          <Text dimColor>· participants:</Text>
          {rows.map((r) => (
            <Text key={r.name} dimColor>
              {"    "}
              {r.name} — {r.scope}
            </Text>
          ))}
        </Box>
      );
    }
    default:
      return null;
  }
};

import React from "react";
import { Box, Text } from "ink";
import type { CoEvent } from "../types.js";

export interface ToolProgressMap {
  [toolUseId: string]: { toolName: string; elapsedSec: number };
}

interface Props {
  events: CoEvent[];
  showAuthorPrefix: boolean;
  myName: string;
  streamingText: string;
  toolProgress: ToolProgressMap;
}

export const Conversation: React.FC<Props> = ({
  events,
  showAuthorPrefix,
  myName,
  streamingText,
  toolProgress,
}) => {
  // A tool is "in progress" if we have a tool_call without a matching
  // tool_result. Show the most recent one (Claude does one at a time).
  const completedToolUseIds = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_result") completedToolUseIds.add(e.toolUseId);
  }
  const inflightToolCalls: Array<{
    toolUseId: string;
    toolName: string;
    elapsedSec?: number;
  }> = [];
  for (const e of events) {
    if (e.type === "tool_call" && !completedToolUseIds.has(e.toolUseId)) {
      const tp = toolProgress[e.toolUseId];
      inflightToolCalls.push({
        toolUseId: e.toolUseId,
        toolName: e.toolName,
        ...(tp ? { elapsedSec: tp.elapsedSec } : {}),
      });
    }
  }
  const lastInflight = inflightToolCalls[inflightToolCalls.length - 1];

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
      {streamingText && (
        <Box>
          <Text color="yellow">claude </Text>
          <Text>{streamingText}</Text>
          <Text color="yellow">▎</Text>
        </Box>
      )}
      {lastInflight && !streamingText && (
        <Box>
          <Text dimColor>
            ↪ {lastInflight.toolName} — running
            {lastInflight.elapsedSec !== undefined
              ? ` ${lastInflight.elapsedSec.toFixed(0)}s`
              : ""}
            …
          </Text>
        </Box>
      )}
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
          <Text dimColor>
            ↪ {event.toolName}({preview})
          </Text>
        </Box>
      );
    }
    case "tool_result": {
      const preview = previewToolResult(event.content);
      if (!preview) return null;
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor color={event.isError ? "red" : undefined}>
            {preview}
          </Text>
        </Box>
      );
    }
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

function previewToolResult(content: unknown): string {
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    // Anthropic tool_result content is sometimes a list of {type:'text', text}.
    text = content
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("\n");
    if (!text) {
      try {
        text = JSON.stringify(content);
      } catch {
        text = "";
      }
    }
  } else {
    try {
      text = JSON.stringify(content);
    } catch {
      return "";
    }
  }
  if (!text.trim()) return "";
  const lines = text.split("\n");
  const head = lines.slice(0, 3).join("\n");
  const truncated = head.length > 200 ? head.slice(0, 197) + "…" : head;
  const omitted = lines.length > 3 ? `\n  … (${lines.length - 3} more lines)` : "";
  return truncated + omitted;
}

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
    case "rate_limit_event":
      return (
        <Box>
          <Text color="yellow">⏳ rate limit hit — slowing down</Text>
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
}

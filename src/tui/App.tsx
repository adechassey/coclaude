import React, { useEffect, useState } from "react";
import { Box } from "ink";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "../session/Session.js";
import type { CoEvent } from "../types.js";
import { Conversation } from "./Conversation.js";
import { ComposeBox } from "./ComposeBox.js";
import { StatusBar } from "./StatusBar.js";

interface Props {
  session: Session;
}

export const App: React.FC<Props> = ({ session }) => {
  const [events, setEvents] = useState<CoEvent[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected] = useState(0); // milestone 2 will wire this up
  const [lastCostUsd, setLastCostUsd] = useState<number | undefined>(undefined);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(
    session.getSlashCommands(),
  );

  useEffect(() => {
    const offEvents = session.on((event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "user_prompt") setThinking(true);
      if (event.type === "result") {
        setThinking(false);
        setLastCostUsd(event.totalCostUsd);
      }
      if (event.type === "system" && event.subtype === "error") {
        setThinking(false);
      }
    });
    const offCommands = session.onSlashCommands(setSlashCommands);
    return () => {
      offEvents();
      offCommands();
    };
  }, [session]);

  // Author prefix on history items appears the moment a second participant arrives.
  const showAuthorPrefix = connected > 0;

  return (
    <Box flexDirection="column">
      <StatusBar
        hostName={session.hostName}
        sessionId={session.sessionId}
        thinking={thinking}
        connected={connected}
        {...(lastCostUsd !== undefined ? { lastCostUsd } : {})}
      />
      <Conversation events={events} showAuthorPrefix={showAuthorPrefix} />
      <ComposeBox
        onSubmit={(content) => session.submitPrompt(content)}
        disabled={thinking}
        placeholder="type a message and press enter — / for commands"
        slashCommands={slashCommands}
      />
    </Box>
  );
};

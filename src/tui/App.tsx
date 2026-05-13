import React, { useEffect, useState } from "react";
import { Box, useInput } from "ink";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type {
  SessionView,
  JoinRequest,
  ToolApprovalRequest,
} from "../session/SessionView.js";
import type { CoEvent } from "../types.js";
import type { Participant } from "../wire/protocol.js";
import { Conversation } from "./Conversation.js";
import { ComposeBox } from "./ComposeBox.js";
import { StatusBar } from "./StatusBar.js";
import { JoinApproval } from "./JoinApproval.js";
import { ToolApproval } from "./ToolApproval.js";

interface Props {
  session: SessionView;
  joinUrl?: string;
}

export const App: React.FC<Props> = ({ session, joinUrl }) => {
  const [events, setEvents] = useState<CoEvent[]>(() => session.getEvents().slice());
  const [thinking, setThinking] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>(
    session.getParticipants(),
  );
  const [lastCostUsd, setLastCostUsd] = useState<number | undefined>(undefined);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(
    session.getSlashCommands(),
  );
  const [queueDepth, setQueueDepth] = useState<number>(session.getQueueDepth());
  const [pendingJoins, setPendingJoins] = useState<JoinRequest[]>([]);
  const [pendingTools, setPendingTools] = useState<ToolApprovalRequest[]>([]);

  useEffect(() => {
    // Use onFuture for events because we seeded state from getEvents()
    // already — replay would duplicate.
    const offEvents = session.onFuture((event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "user_prompt") setThinking(true);
      if (event.type === "result") {
        setThinking(false);
        setLastCostUsd(event.totalCostUsd);
      }
      if (event.type === "interrupted") {
        setThinking(false);
      }
      if (event.type === "system" && event.subtype === "error") {
        setThinking(false);
      }
    });
    const offCommands = session.onSlashCommands(setSlashCommands);
    const offParticipants = session.onParticipants(setParticipants);
    const offQueue = session.onQueueChange(setQueueDepth);
    const offJoinReq = session.onJoinRequest((req) => {
      setPendingJoins((prev) => [...prev, req]);
    });
    const offToolReq = session.onToolApproval((req) => {
      setPendingTools((prev) => [...prev, req]);
    });
    return () => {
      offEvents();
      offCommands();
      offParticipants();
      offQueue();
      offJoinReq();
      offToolReq();
    };
  }, [session]);

  // Esc interrupts the in-flight turn (only meaningful while thinking).
  useInput((_input, key) => {
    if (key.escape && thinking) {
      session.interrupt();
    }
  });

  const showAuthorPrefix = participants.length > 0;
  const currentJoin = pendingJoins[0];
  const currentTool = pendingTools[0];
  const composeDisabled = thinking || !!currentJoin || !!currentTool;

  return (
    <Box flexDirection="column">
      <StatusBar
        hostName={session.hostName}
        myName={session.myName}
        isHost={session.isHost}
        sessionId={session.sessionId}
        thinking={thinking}
        participants={participants}
        queueDepth={queueDepth}
        {...(joinUrl ? { joinUrl } : {})}
        {...(lastCostUsd !== undefined ? { lastCostUsd } : {})}
      />
      <Conversation
        events={events}
        showAuthorPrefix={showAuthorPrefix}
        myName={session.myName}
      />
      {currentJoin && (
        <JoinApproval
          request={currentJoin}
          onResolved={() =>
            setPendingJoins((prev) =>
              prev.filter((r) => r.id !== currentJoin.id),
            )
          }
        />
      )}
      {!currentJoin && currentTool && (
        <ToolApproval
          request={currentTool}
          onResolved={() =>
            setPendingTools((prev) =>
              prev.filter((r) => r.id !== currentTool.id),
            )
          }
        />
      )}
      <ComposeBox
        onSubmit={(content) => session.submitPrompt(content)}
        disabled={composeDisabled}
        placeholder={
          thinking
            ? "esc to interrupt"
            : "type a message and press enter — / for commands"
        }
        slashCommands={slashCommands}
      />
    </Box>
  );
};

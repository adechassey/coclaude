import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { JoinRequest } from "../session/SessionView.js";

interface Props {
  request: JoinRequest;
  onResolved: () => void;
}

export const JoinApproval: React.FC<Props> = ({ request, onResolved }) => {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "a") {
      request.resolve("approve");
      onResolved();
      return;
    }
    if (key === "d") {
      request.resolve("deny");
      onResolved();
      return;
    }
  });

  useEffect(() => {
    // Auto-deny after 60s if the host is afk.
    const timer = setTimeout(() => {
      request.resolve("deny", "approval timed out (60s)");
      onResolved();
    }, 60_000);
    return () => clearTimeout(timer);
  }, [request, onResolved]);

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color="yellow">
        ⚠ join request
      </Text>
      <Text>
        <Text bold>{request.name}</Text>
        <Text dimColor> wants to join from {request.remoteAddress}</Text>
      </Text>
      <Text dimColor>[a]pprove · [d]eny · auto-deny in 60s</Text>
    </Box>
  );
};

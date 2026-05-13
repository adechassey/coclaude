import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { ToolApprovalRequest } from "../session/SessionView.js";

interface Props {
  request: ToolApprovalRequest;
  onResolved: () => void;
}

export const ToolApproval: React.FC<Props> = ({ request, onResolved }) => {
  useInput((input) => {
    const k = input.toLowerCase();
    if (k === "a") {
      request.resolve({ decision: "approve" });
      onResolved();
      return;
    }
    if (k === "d") {
      request.resolve({ decision: "deny" });
      onResolved();
      return;
    }
    if (k === "p") {
      // Approve once + promote scope so future calls auto-approve.
      const next = nextScope(request.currentScope);
      if (next) {
        request.resolve({ decision: "approve", promoteScope: next });
      } else {
        request.resolve({ decision: "approve" });
      }
      onResolved();
      return;
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      request.resolve({ decision: "deny", reason: "approval timed out (60s)" });
      onResolved();
    }, 60_000);
    return () => clearTimeout(timer);
  }, [request, onResolved]);

  const inputPreview = formatInput(request.input);

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color="yellow">
        ⚠ tool-call approval
      </Text>
      <Text>
        <Text color="magenta" bold>
          [{request.author}]
        </Text>
        <Text> wants to run </Text>
        <Text bold>{request.toolName}</Text>
        <Text dimColor> (scope: {request.currentScope})</Text>
      </Text>
      <Text dimColor>{inputPreview}</Text>
      <Text dimColor>
        [a]pprove once · [p]romote scope · [d]eny · auto-deny in 60s
      </Text>
    </Box>
  );
};

function nextScope(
  current: ToolApprovalRequest["currentScope"],
): ToolApprovalRequest["currentScope"] | null {
  switch (current) {
    case "readonly":
      return "edits";
    case "edits":
      return "bash";
    case "bash":
      return "unrestricted";
    case "unrestricted":
      return null;
  }
}

function formatInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    if (s.length > 120) return s.slice(0, 117) + "…";
    return s;
  } catch {
    return String(input);
  }
}

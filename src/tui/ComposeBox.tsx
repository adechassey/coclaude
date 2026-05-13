import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";

interface Props {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  slashCommands?: SlashCommand[];
  history?: string[];
}

export const ComposeBox: React.FC<Props> = ({
  onSubmit,
  disabled,
  placeholder,
  slashCommands = [],
  history = [],
}) => {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // -1 means "not navigating history; current draft"; otherwise index from
  // the end of the history array (0 = most recent).
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");
  const { exit } = useApp();

  const showPicker = value.startsWith("/") && slashCommands.length > 0;
  const query = value.slice(1).toLowerCase();
  const matches = showPicker
    ? slashCommands
        .filter((c) => {
          if (c.name.toLowerCase().startsWith(query)) return true;
          if (c.aliases?.some((a) => a.toLowerCase().startsWith(query))) return true;
          return false;
        })
        .slice(0, 8)
    : [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [value]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (disabled) return;

    // Slash-command picker
    if (showPicker && matches.length > 0) {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(matches.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        const chosen = matches[selectedIndex];
        if (chosen) setValue("/" + chosen.name + " ");
        return;
      }
    }

    // Prompt history (only when picker is closed). Up/Down cycle through
    // prior submissions. Going past the newest goes back to the draft.
    if (!showPicker && history.length > 0) {
      if (key.upArrow) {
        setHistoryIndex((i) => {
          const next = i < 0 ? 0 : Math.min(i + 1, history.length - 1);
          if (i < 0) setDraftBeforeHistory(value);
          const idx = history.length - 1 - next;
          setValue(history[idx] ?? "");
          return next;
        });
        return;
      }
      if (key.downArrow) {
        setHistoryIndex((i) => {
          if (i < 0) return -1;
          const next = i - 1;
          if (next < 0) {
            setValue(draftBeforeHistory);
            return -1;
          }
          const idx = history.length - 1 - next;
          setValue(history[idx] ?? "");
          return next;
        });
        return;
      }
    }

    // Multi-line: Ctrl+J or a raw \n insert a newline. Plain Enter submits.
    const wantsNewline =
      (key.ctrl && (input === "j" || input === "\n")) || input === "\n";
    if (wantsNewline) {
      setValue((v) => v + "\n");
      setHistoryIndex(-1);
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue("");
        setSelectedIndex(0);
        setHistoryIndex(-1);
        setDraftBeforeHistory("");
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setHistoryIndex(-1);
      return;
    }
    if (key.meta || key.ctrl) return;
    if (input) {
      setValue((v) => v + input);
      setHistoryIndex(-1);
    }
  });

  const lines = value.length > 0 ? value.split("\n") : [""];

  return (
    <Box flexDirection="column">
      {showPicker && matches.length > 0 && (
        <Box flexDirection="column" paddingX={2}>
          {matches.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text
                color={i === selectedIndex ? "cyan" : undefined}
                bold={i === selectedIndex}
              >
                {i === selectedIndex ? "❯ " : "  "}/{cmd.name}
                {cmd.argumentHint ? ` ${cmd.argumentHint}` : ""}
              </Text>
              {cmd.description && (
                <Text dimColor> — {cmd.description}</Text>
              )}
            </Box>
          ))}
          <Text dimColor>
            ↑↓ select · tab to complete · enter to submit
          </Text>
        </Box>
      )}
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        {value.length === 0 && placeholder && !disabled && (
          <Box>
            <Text color="white">{"> "}</Text>
            <Text dimColor>{placeholder}</Text>
            <Text color="cyan">▎</Text>
          </Box>
        )}
        {value.length > 0 &&
          lines.map((line, i) => (
            <Box key={i}>
              <Text color={disabled ? "gray" : "white"}>
                {i === 0 ? (disabled ? "… " : "> ") : "  "}
                {line}
              </Text>
              {i === lines.length - 1 && !disabled && (
                <Text color="cyan">▎</Text>
              )}
            </Box>
          ))}
        {value.length === 0 && disabled && (
          <Box>
            <Text color="gray">… </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

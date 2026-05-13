import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";

interface Props {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  slashCommands?: SlashCommand[];
}

export const ComposeBox: React.FC<Props> = ({
  onSubmit,
  disabled,
  placeholder,
  slashCommands = [],
}) => {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { exit } = useApp();

  const showPicker = value.startsWith("/") && slashCommands.length > 0;
  const query = value.slice(1).toLowerCase(); // strip leading /
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

    // Slash-command picker controls
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

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue("");
        setSelectedIndex(0);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.meta || key.ctrl) return;
    if (input) setValue((v) => v + input);
  });

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
      <Box borderStyle="round" paddingX={1}>
        <Text color={disabled ? "gray" : "white"}>
          {disabled ? "… " : "> "}
          {value || (placeholder && !disabled ? <Text dimColor>{placeholder}</Text> : "")}
          {!disabled && <Text color="cyan">▎</Text>}
        </Text>
      </Box>
    </Box>
  );
};

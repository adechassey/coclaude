import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";

interface Props {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  slashCommands?: SlashCommand[];
  history?: string[];
  listFiles: () => Promise<string[]>;
}

// Subsequence fuzzy match with bonuses for word-boundary hits, consecutive
// runs, and shorter paths. Returns null when query chars don't all appear
// in order in target.
function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let score = 0;
  let qi = 0;
  let lastMatch = -1;
  let consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    const prev = ti === 0 ? "" : t[ti - 1];
    const boundary = ti === 0 || prev === "/" || prev === "." || prev === "_" || prev === "-";
    if (boundary) score += 10;
    if (lastMatch === ti - 1) {
      consecutive++;
      score += 5 + consecutive;
    } else {
      consecutive = 0;
    }
    score += 1;
    lastMatch = ti;
    qi++;
  }
  if (qi < q.length) return null;
  return score - target.length * 0.05;
}

function findActiveAt(value: string): { start: number; query: string } | null {
  const lastWs = Math.max(
    value.lastIndexOf(" "),
    value.lastIndexOf("\n"),
    value.lastIndexOf("\t"),
  );
  const tokenStart = lastWs + 1;
  const token = value.slice(tokenStart);
  if (token.length === 0 || token[0] !== "@") return null;
  return { start: tokenStart, query: token.slice(1) };
}

export const ComposeBox: React.FC<Props> = ({
  onSubmit,
  disabled,
  placeholder,
  slashCommands = [],
  history = [],
  listFiles,
}) => {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  // -1 means "not navigating history; current draft"; otherwise index from
  // the end of the history array (0 = most recent).
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");
  const { exit } = useApp();

  // Files are fetched lazily — only when the @-picker first opens within a
  // turn. We invalidate after each submit so the next turn sees fresh state.
  // On joiners this is an RPC; on the host it's a local git ls-files.
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const filesFetched = useRef(false);
  const refreshGen = useRef(0);
  const refreshFiles = async () => {
    const gen = ++refreshGen.current;
    filesFetched.current = true;
    const files = await listFiles();
    if (gen === refreshGen.current) setAllFiles(files);
  };

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

  const activeAt = showPicker ? null : findActiveAt(value);
  const showFilePicker = activeAt !== null;
  const fileQuery = activeAt?.query ?? "";
  const fileMatches = showFilePicker
    ? allFiles
        .map((f) => ({ f, s: fuzzyScore(fileQuery, f) }))
        .filter((x): x is { f: string; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((x) => x.f)
    : [];

  useEffect(() => {
    if (showFilePicker && !filesFetched.current) refreshFiles();
  }, [showFilePicker]);

  useEffect(() => {
    setSelectedIndex(0);
    setSelectedFileIndex(0);
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

    // @-file picker
    if (showFilePicker && fileMatches.length > 0 && activeAt) {
      if (key.upArrow) {
        setSelectedFileIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedFileIndex((i) => Math.min(fileMatches.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        const chosen = fileMatches[selectedFileIndex];
        if (chosen) setValue(value.slice(0, activeAt.start) + "@" + chosen + " ");
        return;
      }
    }

    // Prompt history (only when neither picker is open). Up/Down cycle
    // through prior submissions; past the newest, restore the draft.
    if (!showPicker && !showFilePicker && history.length > 0) {
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

    // Multi-line: any modifier+Enter inserts a newline; plain Enter submits.
    // Terminals report this in several ways:
    //   - `key.shift && key.return` when Ink can parse the modifier
    //   - raw LF for terminals configured to send `\n` on shift+enter
    //   - xterm modifyOtherKeys (`CSI 27 ; <mods> ; 13 ~`) used by Ghostty et al.
    //   - kitty CSI u (`CSI 13 ; <mods> u`)
    const modifiedEnter =
      /^\x1b?\[27;\d+;13~$/.test(input) || /^\x1b?\[13;\d+u$/.test(input);
    const wantsNewline =
      (key.shift && key.return) || input === "\n" || modifiedEnter;
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
        // Invalidate the file cache so the next turn re-fetches the host's
        // current state (file may have been created/deleted by the prior turn).
        filesFetched.current = false;
        setAllFiles([]);
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
      {showFilePicker && fileMatches.length > 0 && (
        <Box flexDirection="column" paddingX={2}>
          {fileMatches.map((f, i) => (
            <Box key={f}>
              <Text
                color={i === selectedFileIndex ? "cyan" : undefined}
                bold={i === selectedFileIndex}
              >
                {i === selectedFileIndex ? "❯ " : "  "}@{f}
              </Text>
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

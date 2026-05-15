# ADR 0001 — No plugin framework for coclaude slash commands

**Status:** accepted
**Date:** 2026-05-15

## Context

`Session.handleCoclaudeCommand` dispatches the four coclaude-local slash commands (`/grant`, `/revoke`, `/kick`, `/who`). Before the [[Authorizer]] extraction, the handler was ~144 lines of validate-then-emit-error repetition, with each command implementing the same shape: parse args, check participant exists, mutate state, emit success or emit error. An architecture review naturally surfaced "extract a command registry / plugin framework" as a deepening candidate.

## Decision

**No command framework.** The four commands stay as a small switch inside `Session`.

## Why

The duplication that motivated the framework idea was concentrated in `/grant` and `/revoke` — both validated participant existence, mutated `scopes`, and emitted `scope_changed`. After extracting the [[Authorizer]] (see [CONTEXT.md](../../CONTEXT.md)), `grant`/`revoke` collapse to ~6 lines each: parse args, delegate to `authorizer.grant`/`authorizer.revoke`, emit the result's error message on failure. The Authorizer absorbed the duplication.

What remains is three commands sharing a 15-line dispatch shell. Splitting that across a `CommandRegistry` + per-command modules would scatter readable code into infrastructure, with no leverage payoff. The deletion test fails: delete a hypothetical registry and three small commands re-inline cleanly with no callers elsewhere.

## When to revisit

If the count grows materially (`/regen`, `/pass`, and a few more land — say six or more commands) AND the commands start sharing genuinely non-trivial validation or permission logic that the Authorizer can't absorb, reopen this. Until then: keep the switch.

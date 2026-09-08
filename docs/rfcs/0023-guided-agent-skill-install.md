# RFC 0023 — Guided Agent Skill installation

- Status: Proposed
- Date: 2026-09-08
- Owners: Token Harness

## Summary

The browser becomes the human entry point for enabling the Agent Skill introduced by RFC 0022.
Claude Code and Codex still consume the same portable skill and the existing JSON CLI remains the
deterministic controller. The browser adds one reviewed action: **Enable in-session guidance**.

## Targets

For a detected user installation Token Harness resolves only the documented user-level locations:

- Claude Code: `~/.claude/skills/token-harness/SKILL.md`;
- Codex: `$HOME/.agents/skills/token-harness/SKILL.md`.

The installed harness version is recorded in the stored plan. If it changes between preview and
apply, the existing stored-plan version check refuses the mutation. An unobservable harness version
therefore produces no persistent skill plan.

## Ownership and conflicts

The skill is a `write-owned-file` action preceded by reversible directory creation where needed.
The transaction engine snapshots absence and content before writing. The exact portable SKILL.md
payload is compiled into the local bundle and an integration gate keeps it byte-identical to the
repository source.

If a `token-harness` skill directory already exists, Token Harness never overwrites or silently
adopts it. Byte-identical existing content is reported as already present but remains user-owned
unless a prior Token Harness transaction already owns it. Different content is a visible conflict.
A target change after preview changes the recomputed skill plan and apply fails closed before the
reviewed stored actions can run.

## UI contract

Each detected Claude/Codex card and its Rules & settings view can expose **Enable in-session
guidance**. The preview describes one Agent Skill installation rather than surfacing implementation
directories as separate user decisions. Approval remains single-use and time-bounded. Apply uses the
existing plan/apply transaction, backup and drift machinery.

The loading skeleton uses the same `agent` card padding as the loaded card. This prevents text from
jumping horizontally when partial observations replace the initial Claude/Codex placeholders.

## Non-goals

This phase does not add an MCP server, daemon, background model, automatic model switch, credential
access, billing change, hook trust change, or a second quota formula. It also does not run Token
Harness before every tool call. The skill remains progressively disclosed and advisory by default.

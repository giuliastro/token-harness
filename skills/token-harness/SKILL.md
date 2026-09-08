---
name: token-harness
description: Optimizes local Claude Code or Codex work against observed subscription allowance, context pressure, quality floors, and project-local benchmark evidence using the Token Harness CLI. Use when the user asks to conserve or maximize coding-agent allowance, choose reasoning/model/verbosity deliberately, check whether a task fits current quota, or explicitly asks to use Token Harness.
---

# Token Harness

Use Token Harness as a local deterministic policy engine. Do not reproduce its quota math or invent provider conversions yourself.

## Default workflow

1. Confirm `token-harness --version` works. If it is missing, do not install it silently. If the user asked to install or set up Token Harness, follow that request; otherwise explain that the local CLI is required.
2. Identify the harness you are currently running as: `claude` for Claude Code or `codex` for Codex. Do not guess from repository files.
3. Classify the current task conservatively:
   - `mechanical`: formatting, rename, lookup, simple edits, deterministic scaffolding.
   - `standard`: ordinary implementation, tests, focused bug fixes.
   - `hard`: multi-file reasoning, ambiguous failures, migrations, difficult reviews.
   - `critical`: architecture, security-sensitive work, releases, or high-regression-risk changes.
   If uncertain between two classes, use the higher class.
4. For a substantial task, or whenever the user asks about allowance/efficiency, run:

   `token-harness optimize --harness <claude|codex> --task <class> --profile balanced --json`

5. Treat the JSON result as evidence, not as permission to mutate configuration. Prefer recommendations that reduce avoidable context or session overhead before lowering a quality floor.
6. Continue with the user's task. Mention Token Harness only when it materially changes the plan, recommends a user-visible action, or lacks enough evidence.

Do not run Token Harness before every trivial tool call. One observation at a meaningful task boundary is normally enough; re-observe when the task class changes materially, after a quota reset, after a substantial session/context change, or when the user asks.

## Explicit workload

Only pass `--tasks-left N` when the remaining accepted-task count is explicit from the user or an explicit task list already in the conversation. Never infer it from token history, source files, GitHub issues, or a guessed backlog.

For multiple independent new tasks whose explicit list can be classified by task class, Token Harness can compare Claude and Codex with:

`token-harness schedule --current <current> --candidate <other> --workload mechanical=N,standard=N,hard=N,critical=N --json`

Omit zero-count classes. This is for queued new work, not an in-progress handoff. Never switch harnesses automatically from this result.

## Persistent native changes

`optimize` is advisory. If it recommends a persistent model/reasoning/verbosity change and the user wants it applied:

1. Build a reviewed plan with `token-harness plan --harness <claude|codex> --native-policy --task <class> --profile balanced --json`.
2. Summarize the exact proposed change, scope, and any limitations to the user.
3. Apply only after the user explicitly approves the proposed mutation. Use the returned plan id with `token-harness apply --plan <id> --yes`.
4. Do not treat a persisted preference as a live change to an already-running session. Follow the plan/result instructions about when it takes effect.

Never silently change authentication, billing, provider, model routing, hooks, trust, or purchase/redeem credits.

## Evidence rules

- Never equate local token counts with subscription quota.
- Never compare raw Claude and Codex percentages as if they were the same currency.
- Unknown allowance or benchmark evidence stays unknown.
- Preserve task quality floors; do not lower effort merely because a cheaper setting exists.
- Prefer project-local measured outcomes and backend quota deltas when Token Harness exposes them.
- Do not add an MCP server or background model just to use this skill. The local CLI is the tool surface.

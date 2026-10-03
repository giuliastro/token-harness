---
name: token-harness
description: Optimizes local Claude Code or Codex work against observed subscription allowance, context pressure, quality floors, and project-local benchmark evidence using the Token Harness CLI. Guides native subagent model routing for substantial bounded coding tasks. Use for substantial coding work where native delegation may apply, or when the user asks about allowance, model/effort/verbosity choices, quota fit, or Token Harness.
---

# Token Harness

Use Token Harness as a local deterministic policy engine. Do not reproduce its quota math or invent provider conversions yourself.

## Automatic routing

When enabled in the Token Harness dashboard, a native prompt hook supplies the routing policy on every submitted prompt. This works without invoking this skill or prefixing the prompt with a command. The hook asks the coding agent to delegate only eligible bounded work; it does not change the root model or prove which child model ran. Use this skill when the user asks for explicit quota-aware advice or a benchmark.

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

## Active context evidence

When the current conversation or your own tool results directly establish useful task-state evidence, you may pass a short-lived `--context-snapshot` file to `optimize`. This metadata is for the CLI; never ask the user to write or understand the JSON. Skip the snapshot when no actionable evidence is directly observable or a temporary file cannot be safely created and removed.

- Set task boundary, validation and quality only from explicit task state and checks you observed. Use `unknown` when those facts are missing or ambiguous.
- Mark material superseded or condensable only when its current state is directly clear. Include `byteLength` only when tooling measured the exact local bytes; otherwise use `null`. Never estimate bytes from tokens.
- Set reducer attribution only when directly known; otherwise use `unknown`. Do not include transcript text, prompts, tool payloads, source text, paths, MCP names or schemas.
- Add a checkpoint byte ceiling only when you will use that same ceiling for the existing bounded `token-harness handoff` command. Omit it when no artifact budget is configured.
- Create the metadata file temporarily, run `optimize`, then remove it. Treat the decision as advice; do not mask, summarize, compact or start a session on the user's behalf.

## Explicit workload

Only pass `--tasks-left N` when the remaining accepted-task count is explicit from the user or an explicit task list already in the conversation. Never infer it from token history, source files, GitHub issues, or a guessed backlog. When it is explicit, add it to the same advisory call:

`token-harness optimize --harness <claude|codex> --task <class> --profile balanced --tasks-left <N> --json`

For multiple independent new tasks whose explicit list can be classified by task class, Token Harness can compare Claude and Codex with:

`token-harness schedule --current <current> --candidate <other> --workload mechanical=N,standard=N,hard=N,critical=N --json`

Omit zero-count classes. This is for queued new work, not an in-progress handoff. Never switch harnesses automatically from this result.

## Native subagent model routing

Use native subagents as the only model-routing surface. This routes delegated work; it never changes the model already selected for the root conversation. Keep Codex as the first supported path.

For Codex, when the task is substantial and contains a complete, bounded implementation unit that can be handed off without duplicating work, delegate that unit to one native subagent with `model: gpt-6-luna` if Luna is present in the current Codex model picker/catalog. Set the model explicitly in the native spawn request: when it is omitted, Codex inherits the root model and reasoning effort, so a generic delegation is not a cost-routed delegation. If a higher-priority instruction forbids specifying the child model, skip cost routing and continue with the root model. Keep the root model responsible for task framing, integration, and acceptance review. Do not run the same implementation in both agents. Use at most one cost-routed worker at a time.

Skip routing for trivial tasks, tightly coupled or shared-write work, architecture/security/release decisions, work that needs the root model's full context or judgment throughout, when the user asks not to delegate, when the root model is Luna or cannot be identified, or when the requested model is not currently available. Do not substitute an unverified model ID or silently fall back to another harness. If no supported route is available, continue with the current root model.

For Claude Code, apply the same bounded-task rules only when Claude Code is already configured and authenticated and native subagents are available. Request the current native `haiku` alias for an eligible worker; do not configure Claude Code or authenticate on the user's behalf.

Treat the selected child model as a routing request until Codex or Claude Code visibly reports the worker's actual model. A skill instruction is not runtime telemetry. Subagents add context and coordination overhead and can consume more total tokens than single-agent work; do not claim token, quota, or cost savings without paired, quality-gated usage evidence for the same harness and task class.

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

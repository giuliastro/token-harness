# RFC 0022 — Agent-native Token Harness skill

- Status: Proposed
- Date: 2026-09-08
- Owners: Token Harness
- Target: Phase 18.13

## Summary

Token Harness keeps the browser application as the primary human interface and adds an optional
portable Agent Skill for Claude Code and Codex. The skill lets a compatible coding harness invoke
the existing local JSON CLI at meaningful task boundaries so users do not need to learn the
advanced optimizer and scheduler flags.

The skill is orchestration, not a second policy engine. Quota observation, accepted-task capacity,
quality floors, model/effort/verbosity learning, workload allocation, planning and mutation remain
implemented by Token Harness itself.

## Motivation

The advanced CLI has become intentionally expressive: it can distinguish task classes, five-hour
and weekly pressure, explicit workload, exact-policy benchmark evidence, native policy changes and
cross-harness allocation. That is useful as a stable machine interface but is too much surface to
make the normal human workflow.

The product therefore has three layers:

1. **Human layer:** open `token-harness`, approve reviewed setup, keep coding.
2. **Agent layer:** activate the Token Harness skill when allowance or task-policy decisions matter.
3. **Controller layer:** deterministic JSON CLI and domain policy, which remains the authority.

Complexity belongs in layer 3. It must not leak into layer 1 merely because layer 2 can use it.

## Why an Agent Skill

Agent Skills are a better fit than a dedicated MCP server for this first integration because the
workflow is mostly instructions around an already-local CLI. The skill can be loaded only when
relevant, while an MCP server would add another long-lived process, tool schema and lifecycle to
manage without yet proving better optimization outcomes.

No background model, daemon or remote Token Harness service is introduced.

## Skill contract

The portable source lives at:

`skills/token-harness/SKILL.md`

Its frontmatter must have the stable name `token-harness` and a description that tells a harness
both what the skill does and when it is relevant. The body must stay compact and should point the
harness at deterministic CLI operations rather than reimplementing their algorithms in prose.

The skill may:

- verify that the local `token-harness` executable exists;
- identify whether the running coding harness is Claude Code or Codex;
- conservatively classify the current task as mechanical, standard, hard or critical;
- call `optimize --json` for substantial work or explicit allowance questions;
- pass an explicit `--tasks-left` only when the remaining workload is known from user intent;
- call mixed-workload `schedule --json` for an explicit set of independent new tasks;
- prepare a native-policy plan when the user wants a persistent recommendation applied.

The skill must not:

- invoke Token Harness before every trivial tool call;
- infer a workload count from local token history, source code, issue count or a guessed backlog;
- reproduce provider quota formulas or convert local tokens to subscription quota;
- compare raw Claude and Codex percentages as a common currency;
- silently switch harnesses;
- silently install Token Harness;
- silently mutate model, effort, verbosity, authentication, billing, hooks, trust or provider state;
- purchase or redeem credits;
- add an MCP server or background model merely to use Token Harness.

## Activation and cadence

The skill should activate when the user explicitly asks to use Token Harness or asks about coding
allowance, quota longevity, reasoning/model/verbosity efficiency, task fit, or cross-harness
allocation. A harness may also use it at the beginning of a substantial coding task when the skill
is relevant.

One observation at a meaningful task boundary is normally enough. Re-observe when:

- the task class changes materially;
- a known allowance reset occurs;
- session/context state changes substantially;
- explicit workload changes;
- the user asks for a fresh decision.

This cadence avoids spending context and shell calls merely to prove that the optimizer is present.

## Task classification

Classification uses the existing RFC 0011 taxonomy:

- `mechanical`: formatting, rename, lookup, simple edits, deterministic scaffolding;
- `standard`: ordinary implementation, tests, focused bug fixes;
- `hard`: multi-file reasoning, ambiguous failures, migrations, difficult reviews;
- `critical`: architecture, security-sensitive work and high-regression-risk changes.

When uncertain between adjacent classes, the skill chooses the higher class. This protects quality;
it does not learn a hidden task classifier.

## Read-only default

The agent-facing default is advisory:

`token-harness optimize --harness <harness> --task <class> --profile balanced --json`

The skill treats the result as evidence. It may use recommendations to shape its own work, such as
reducing avoidable context or respecting a quality floor, but an optimizer response is not permission
to persist configuration.

The user does not need to see every Token Harness invocation. The agent should surface it only when
it changes the plan, recommends a user-visible action, or lacks evidence required for a decision.

## Explicit workload

`--tasks-left N` is allowed only when N is explicit user intent or comes from an explicit task list
already supplied in the conversation. It is not inferred from repository contents or telemetry.

For multiple independent queued tasks, the agent may classify the explicit list and call:

`token-harness schedule --current <current> --candidate <other> --workload <class=count,...> --json`

The result is advisory. It does not authorize an automatic harness switch and it is not the
in-progress handoff path.

## Persistent native changes

If the user wants a persistent model/reasoning/verbosity recommendation applied, the skill must use
the existing reviewed plan/apply boundary:

1. create a native-policy plan;
2. summarize the exact proposed change, scope and limitations;
3. receive explicit user approval for that proposed mutation;
4. apply the returned plan id;
5. report whether the change affects future sessions or requires a restart/reopen.

Existing drift, compatibility, ownership, backup and rollback checks remain authoritative.

## Context and privacy

The skill calls a local executable. It does not send prompts, source code, credentials or quota data
to a Token Harness service. Token Harness continues to use supported local/native observation
surfaces and project-local receipts under the existing privacy contract.

The skill itself stays concise. Detailed policy remains in executable code and RFCs rather than being
copied into every agent context.

## Distribution in this phase

Phase 18.13 ships the portable skill source and its tested contract in the repository. It does not
hard-code Claude Code or Codex skill-discovery directories and does not mutate those directories
automatically.

Discovery/install mechanisms are version- and surface-sensitive. A later phase may bundle the skill
inside the npm artifact and let the guided application install it only after current Claude/Codex
locations and ownership semantics are verified with compatibility fixtures. Until then, users may
import/install the `skills/token-harness` directory using a supported Agent Skills mechanism.

## Acceptance

Phase 18.13 is complete when:

- the portable `SKILL.md` exists and passes static contract tests;
- task classes and explicit-workload semantics match the controller contract;
- advisory calls are machine-readable and do not mutate configuration;
- persistent mutation remains behind explicit review and approval;
- the README explains that advanced flags are an agent/controller interface, not the normal human
  workflow;
- no MCP server, background model or duplicate optimizer implementation is introduced;
- Windows, macOS and Linux CI remain green.

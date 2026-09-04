# RFC 0011 — Quota-aware Claude Code and Codex orchestration

- Status: Proposed
- Date: 2026-08-30
- Owners: Token Harness
- Target: post-0.2 product direction

## Summary

Token Harness changes its primary optimization target from "tokens removed by reducers" to
**useful coding work completed per included Claude Code/Codex usage allowance**.

Token reduction remains an important mechanism, but it is only one mechanism. The control plane must
also observe real usage windows, manage context growth, minimize instruction and MCP overhead, choose
native models and reasoning effort deliberately, and coordinate work across independently limited
harnesses.

This RFC adds the product and domain contracts needed for that change. It does not change the
existing transaction, ownership, verification, or metrics safety invariants.

## Context

Subscription usage is not a simple token wallet.

As observed on 2026-08-30:

- Claude subscriptions use rolling five-hour session limits and paid plans add weekly limits.
  Claude web/app traffic and Claude Code consume the same plan pool. Available usage depends on
  conversation length, model, tools/features, and effort.
- Claude Code can change model during a session and exposes context/session controls. Long
  conversations repeatedly carry history, so avoiding stale context can matter more than compressing
  one command result.
- Anthropic's June 15 update paused the previously announced separate Agent SDK / `claude -p`
  monthly credit. These paths still draw from subscription limits. Token Harness must not model a
  separate Claude SDK bucket unless Anthropic later activates one and a supported surface proves it.
- Codex subscription usage includes a five-hour window and can also have weekly limits. Model choice
  materially changes how long the allowance lasts.
- Codex app-server exposes structured ChatGPT rate-limit state through
  `account/rateLimits/read`, including current percentage, window duration, reset time, reached
  state, and reset-credit inventory.
- Codex configuration already exposes model, reasoning effort, plan-mode reasoning effort,
  verbosity, project instruction-byte limits, tool-output token limits, and feature switches that
  can defer or search tools/MCP surfaces.

Therefore a generic model router or another compressor is not the first missing layer. The missing
layer is a budget-aware controller that can answer:

1. how much verified allowance remains;
2. how quickly it is being consumed relative to reset time;
3. which avoidable context is being sent on each turn;
4. whether the current model/effort is justified by the task;
5. whether another enabled tool or MCP server is costing more context than it contributes;
6. whether Claude Code or Codex currently has the better expected quality/headroom tradeoff.

## Goals

1. Maximize successful coding work per included subscription allowance.
2. Preserve or improve task quality; "fewer tokens" is never success by itself.
3. Prefer native harness controls before adding a third-party interception layer.
4. Make live quota state observable without credential scraping when a supported surface exists.
5. Keep every mutation reviewable, reversible, and version-gated under the existing transaction
   model.
6. Make model names, supported effort levels, and quota buckets discoverable rather than permanent
   constants.
7. Keep external API/paid overflow explicit and opt-in.

## Non-goals

- reverse-engineering an undocumented token-to-subscription-quota formula;
- bypassing, evading, or circumventing provider usage limits;
- automatically purchasing credits or redeeming reset credits;
- silently switching from included subscription usage to API-key billing;
- claiming that a local token reduction caused an identical percentage reduction in backend quota;
- routing prompts to external providers without explicit policy and credential/data-residency review.

## New domain concepts

### UsageWindowSnapshot

A read-only observation of a provider/harness limit:

```ts
interface UsageWindowSnapshot {
  harness: "claude" | "codex";
  bucketId: string | null;
  scope: "five-hour" | "weekly" | "monthly" | "model" | "credit" | "unknown";
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  observedAt: string;
  source: "native-rpc" | "native-cli" | "local-history" | "unknown";
  confidence: "authoritative" | "reported" | "estimated";
}
```

A snapshot may contain unknown fields. Unknown is a supported state and is preferable to inferring a
bucket from model names or local token activity.

### TaskClass

The policy engine uses a small explainable classification rather than a learned opaque router:

- `mechanical`: formatting, rename, lookup, simple edits, deterministic scaffolding;
- `standard`: ordinary implementation, tests, focused bug fixes;
- `hard`: multi-file reasoning, ambiguous failures, migrations, difficult reviews;
- `critical`: architecture, security-sensitive review, high-regression-risk changes.

Classification is advisory until benchmark evidence exists. The user can always override it.

### BudgetPolicy

A profile combines quality floor and remaining-budget policy:

- `economy`: maximize allowance longevity while maintaining task acceptance gates;
- `balanced`: default; escalate model/effort only when task class or failed attempts justify it;
- `quality`: spend available headroom more aggressively on hard/critical tasks;
- `custom`: explicit user configuration.

Profiles map to capabilities and discovered model tiers, not hard-coded eternal model IDs.

## New capabilities

The existing capability model is extended with:

| Capability | Mode | Meaning |
| --- | --- | --- |
| `usage.window.observe` | observational | Read live five-hour/weekly/model/credit state |
| `usage.history.observe` | observational | Read local per-session/token history |
| `context.instructions.budget` | exclusive per instruction scope | Constrain or restructure harness instruction files |
| `context.session.advise` | observational | Recommend clear/new-session/compact actions |
| `context.session.compact` | exclusive | Invoke or configure a supported compaction path |
| `model.selection.policy` | exclusive per harness | Select a native subscription model tier |
| `reasoning.effort.policy` | exclusive per harness | Select native effort/reasoning level |
| `model.verbosity.policy` | exclusive per harness | Select native verbosity where available |
| `mcp.schema.exposure` | exclusive per MCP registry | Reduce or defer MCP schema exposure |
| `harness.task.route` | exclusive per task | Recommend or perform a Claude Code ↔ Codex handoff |
| `paid.overflow.route` | exclusive and explicit | Use API/external-provider capacity after opt-in |

External model routers own `paid.overflow.route` or a later provider-routing capability. They do
not automatically own `model.selection.policy` for subscription-authenticated Claude Code/Codex.

## Native telemetry policy

### Codex

Preferred order:

1. app-server `account/rateLimits/read`;
2. app-server update notifications while a Token Harness foreground process is attached;
3. Codex's own user-visible status output;
4. unknown.

The adapter may record reset-credit inventory but MUST NOT invoke the consume/redeem operation without
an explicit user action dedicated to that redemption.

If Codex exposes multiple limit IDs without a documented model-to-bucket mapping, Token Harness
shows the buckets as observed and reports the mapping as unknown.

### Claude Code

Preferred order:

1. a supported native machine-readable usage surface, if the installed version exposes one;
2. Claude Code's own user-visible usage/status surface parsed under an exact compatibility fixture;
3. local historical usage such as ccusage, explicitly classified as history/estimate;
4. unknown.

Token Harness MUST NOT read, export, replay, or call private OAuth endpoints with Claude credentials
merely to obtain live quota telemetry. If Anthropic later documents a machine-readable endpoint, it
can be admitted through the normal versioned adapter process.

## Native policy before external tools

Before assigning a third-party provider, the planner asks whether the installed harness can solve the
same source of waste itself.

Examples:

- Codex native model/reasoning/verbosity profiles precede generic model routers.
- Codex native tool deferral/search precedes Lazy MCP on the same MCP-schema channel.
- Codex `tool_output_token_limit` is measured before another broad tool-output compressor claims
  that surface.
- Claude clear/compact/context controls precede generic prompt-compression libraries.
- Native model/effort controls precede Caveman-style terse-output instructions.

A third-party tool can still win if benchmark fixtures show materially better useful-work-per-quota
results and it does not contest an already owned surface.

## Budget pacing

Token Harness computes an advisory burn state from observations, not from a guessed provider formula.

For a window with a known reset:

- `remaining = 100 - usedPercent`;
- estimate the time remaining until reset;
- compare recent observed usage slope with the configured reserve target;
- classify the window as `under-pace`, `on-pace`, `over-pace`, or `unknown`.

Policy examples:

- over-pace + mechanical task → recommend economical model tier and low/medium effort;
- over-pace + hard task → keep quality floor, but first remove stale context/MCP/tool overhead;
- under-pace near reset → allow a higher tier for hard work rather than finishing the window with
  unused capacity;
- weekly reserve threatened → prefer economy even if the current five-hour window has headroom.

This is a recommendation engine first. Automatic managed profile switching is a later stage and must
be opt-in.

## Context hygiene policy

The planner measures at least:

- current project instruction bytes and hierarchy;
- enabled MCP servers and, where measurable, schema/context contribution;
- session age/turn count and available context telemetry;
- tool-output volume by tool family;
- repeated command/output patterns;
- repository context retrieval volume.

Recommendations must be actionable and bounded, for example:

- split a monolithic `AGENTS.md` into root + subtree guidance;
- remove duplicated rules from `CLAUDE.md`;
- disable an MCP server unused by the task;
- compact or start a new task/session after a task boundary;
- use RTK/HarnessTrim for a noisy command family;
- use Dejavu when repeated reruns dominate.

## Cross-harness scheduling

Claude Code and Codex are treated as separate budget domains unless evidence says otherwise.

For an independent new task, Token Harness may recommend a harness using:

- verified remaining headroom;
- task class and benchmarked quality;
- expected context-transfer cost;
- available native model tiers;
- current weekly reserve.

For an in-progress task, switching harnesses is recommended only when the expected gain exceeds the
handoff cost. A handoff artifact contains only:

- objective and current state;
- decisions already made;
- changed files;
- failing/passing validation;
- unresolved questions;
- next concrete action.

It must not dump the entire source conversation into the target harness.

## Measurement and claims

The primary product KPI becomes **useful work per observed quota delta**.

A task receipt can include:

- harness;
- model/model tier;
- effort/reasoning and verbosity;
- usage-window snapshots before and after;
- local input/output/cached token counts when available;
- instruction bytes;
- MCP/tool inventory;
- reducer stage measurements;
- wall-clock duration;
- task outcome: tests/checks, accepted diff, review result, or explicit user acceptance.

The first paired-receipt comparator is intentionally non-composite: baseline and optimized receipts
must identify the same task class and harness; an explicit quality gate is evaluated first; only
matching authoritative/reported backend windows that do not cross a reset can decide on quota;
failed attempts, runtime/provider errors, attempt count, and local token volume are secondary
evidence. Cached/estimated quota is never promoted into a backend comparison, and local token
volume is never labeled subscription quota.

The first user-facing comparison surface is read-only:
`token-harness benchmark --baseline <receipt.json> --optimized <receipt.json>`. It parses the
schema at runtime, rejects malformed/future/wrong-role receipts, and returns the same deterministic
comparison in human or JSON form.

Receipt collection is deliberately a separate two-phase surface:
`benchmark-start` snapshots quota plus discovered model/effort/verbosity before the user runs the
task, and `benchmark-finish` snapshots quota again and requires an explicit passed/failed quality
gate and attempt counts. The capture lives only under Token Harness state, stores a machine-local
project id rather than a raw project path, and never overwrites an existing capture/receipt. Neither
command executes a harness task or changes harness configuration. The initial slice leaves
`localUsage` null and `errorCodes` empty rather than pretending that ccusage/provider telemetry
can already be correlated perfectly to one task; those fields are admitted only after task-level
attribution exists.

Attribution classes remain strict:

- exact provider token reduction is still exact only for that measured payload;
- local session tokens are local usage history;
- backend quota delta is authoritative only when read from the backend/harness surface;
- causal "quota saved" requires an A/B or another comparable counterfactual and is never derived by
  multiplying token savings by a guessed factor.

## Provider priority under this RFC

### Core / P0

- Claude Code native quota/context/model adapter;
- Codex app-server rate-limit adapter;
- Codex native policy/profile adapter;
- Token Harness budget controller;
- ccusage read-only history importer.

### P1

- RTK;
- HarnessTrim;
- Lazy MCP only after native Codex MCP deferral is benchmarked.

### P2

- one of Context Mode / Headroom;
- Dejavu;
- repowise where its retrieval envelope proves net-positive.

### P3 / explicit overflow

- LiteLLM;
- Claude Code Router;
- RouteLLM;
- LLMRouter;
- vLLM Semantic Router.

### Research only

- LLMLingua;
- Caveman unless native verbosity/effort proves insufficient.

## Delivery order

1. **Read-only quota adapters.** Add `token-harness budget` and JSON snapshots. No model switching.
2. **Context audit.** Add `token-harness context` and `token-harness mcp` with instruction/MCP/tool
   budgets and recommendations.
3. **Advisory policy.** Add `token-harness optimize` with economy/balanced/quality advice based on
   task class, burn state, and quality floor.
4. **Managed native profiles.** Plan/apply/rollback supported Codex/Claude settings only where exact
   compatibility fixtures exist.
5. **Historical learning.** Import ccusage/local receipts to calibrate task classes and expected burn.
6. **Cross-harness handoff.** Add compact handoff generation and recommendation; no automatic
   background execution.
7. **Provider re-benchmark.** Measure RTK, HarnessTrim, Lazy MCP, broad context owner, and Dejavu by
   useful-work-per-quota outcomes.
8. **Optional paid overflow.** Only after a separate policy makes API spend, provider egress, and
   credentials explicit.

## Acceptance gates

The quota-aware release is not complete until:

- Claude and Codex can both report either an observed usage state or an explicit `unknown`;
- no test or production path needs a user's real OAuth credential;
- Codex reset credits are never consumed by a read/plan/apply flow;
- model/effort recommendations cite the observations that caused them;
- a user-owned model/profile setting survives install, update, rollback, and uninstall unless the
  exact entry is owned by Token Harness;
- instruction/MCP changes are byte-for-byte reversible;
- at least three task classes have paired baseline/optimized fixtures with quality gates;
- reports separate local token savings, backend quota delta, and paid API spend;
- generic routers are not required for the default quota-efficiency profile.

## Consequences

Token Harness remains a control plane, but the thing it controls is larger than a chain of reducers.
Its differentiator becomes a measurable feedback loop:

**observe allowance → diagnose waste → choose native policy → reduce context → validate quality →
measure actual burn → adapt the next task.**

That loop is specific to how coding subscriptions are consumed and is therefore more useful than
maximizing a synthetic token-saving percentage.

## Amendment — 2026-09-04 cross-harness transfer evidence

The Phase 18.7 scheduler keeps Claude Code and Codex as independent quota domains. A cross-harness
transfer experiment therefore MUST NOT decide benefit by subtracting or ranking the two harnesses'
backend quota percentages, and MUST NOT use local token counts as a proxy conversion between them.

The first deterministic transfer comparator uses an explicitly paired task experiment:

- `baseline` is the comparable control that stays on the current harness;
- `optimized` is the comparable run that switches to a different candidate harness using the compact
  handoff;
- both receipts identify the same benchmark id and task class;
- the compact handoff must fit the experiment's configured byte budget.

After identity and handoff-budget checks, only evidence with a common meaning across harnesses may
produce a transfer verdict: explicit quality gate, failed-attempt count, normalized runtime/provider
error count, and total attempt count, in that order. An improvement can produce `proven-positive`; a
regression or an over-budget handoff produces `non-positive`; unknown quality, invalid pairing, or a
tie across all comparable observations produces `unknown`.

This comparator does not by itself claim cross-provider quota savings. Live independently assessed
pacing remains the scheduler's budget evidence; the transfer experiment answers only whether a
bounded handoff has demonstrated a useful-work advantage rather than manufacturing a common quota
unit that the providers do not expose.

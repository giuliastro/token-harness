# RFC 0024 — Savings Engine provider expansion

Status: draft

## Purpose

Token Harness 0.1.10 has the policy layer needed to decide *when* a cheaper model, effort, verbosity or harness choice is justified. The next milestone expands the mechanisms that can actually reduce avoidable context/output work.

The objective is not "minimum tokens". The objective is more quality-passed coding work from Claude Code and Codex subscription limits, with each saving mechanism measured in its own evidence class and admitted only when it does not create a larger retry/quality cost.

## Non-negotiable measurement boundary

The following remain separate:

1. provider/local token or character reduction;
2. task attempts, retries, runtime/tool failures and quality outcome;
3. authoritative/reported Claude or Codex allowance movement;
4. API-equivalent cost estimates;
5. cross-harness accepted-task capacity.

A local token reduction is never converted into subscription quota. Raw Claude and Codex percentages are never compared directly. A provider may be useful with only local evidence, but Token Harness must then describe the result as local/context reduction rather than subscription-quota saving.

## Phase 1 candidate order

### 1. Existing baseline: RTK and HarnessTrim

Keep both as the reference reducer stack on channels where their integration is already covered. Re-run paired benchmark receipts before using them as the baseline for newer providers.

Admission requirement: a provider that saves output but increases retries, runtime failures or failed quality gates loses the comparison.

### 2. Tool-schema/context deferral

Evaluate Lazy MCP-style deferred tool exposure against native Codex tool/MCP deferral where available.

Goal: avoid paying context for large tool inventories until a task actually needs them.

Rules:

- native harness deferral wins when it provides the same effect with less configuration/ownership risk;
- do not install an external deferral layer merely because it reports fewer tokens;
- measure tool inventory/schema volume separately from task quality and provider allowance;
- never disable a tool that the current task is known to require;
- a large MCP count alone is not sufficient evidence to mutate configuration.

This is the first new mechanism to implement after this RFC.

### 3. One broad context owner

Re-evaluate Context Mode and Headroom and admit at most one as the default broad context owner.

Running two independent broad context owners by default is prohibited because attribution becomes ambiguous and overlapping compression can increase failure/re-read cost.

Selection requires paired tasks showing:

- quality non-regression;
- no material retry increase;
- attributable context reduction;
- no unsafe ownership of unrelated agent configuration;
- graceful fail-open behavior when the provider cannot act.

### 4. Repeated-work suppression

Evaluate Dejavu-style repeated rerun/context reuse only for patterns Token Harness can identify conservatively.

A cache/reuse hit must not be treated as correct merely because text matches a previous task. Repository state, relevant inputs and task identity must be compatible enough to avoid replaying stale work.

### 5. Retrieval payload reduction

Evaluate repowise-style retrieval only where the retrieved payload is demonstrably smaller/more useful than the native search/read path it replaces.

Retrieval is not automatically an optimization: indexing, irrelevant chunks and repeated expansion can cost more context than direct targeted reads.

## Native controls remain first-class competitors

Before admitting an external provider, compare it with the controls already available in Token Harness and the harness itself:

- reasoning effort;
- verbosity;
- model choice;
- native compaction;
- native MCP/tool deferral;
- bounded cross-harness handoff;
- task/workload-aware scheduling.

An external tool is valuable only when it adds a mechanism that these controls cannot achieve as safely or as effectively.

## Provider admission contract

A new savings provider may become recommended only after all applicable gates pass:

1. **Observable identity** — version/source/configuration can be identified without guesswork.
2. **Contained mutation** — installation/configuration touches an explicit reviewed surface and is reversible or honestly marked non-reversible.
3. **Fail-open runtime** — reducer failure does not destroy the coding command/task output.
4. **Attributable telemetry** — changed output, pass-through and runtime error states can be distinguished without storing prompt/tool payloads.
5. **Quality-gated receipts** — benchmark pairs record explicit task success/failure and attempts.
6. **No false quota claim** — local savings stay local unless authoritative same-window backend quota evidence exists.
7. **Marginal value** — adding the provider on top of the current stack must beat the current stack, not merely beat an unoptimized baseline.
8. **No ownership overlap** — only one provider owns a broad context-reduction surface by default.
9. **Cross-platform evidence** — supported OS/harness/version combinations are recorded; unknown combinations are not silently admitted.
10. **No implicit paid path** — API-key/model-router billing remains outside the default savings stack.

## Benchmark strategy

Use the existing benchmark receipt pipeline and accepted-task capacity model.

For every candidate provider, collect paired mechanical, standard and hard tasks where practical. Critical tasks may validate safety floors but are not a target for aggressive compression.

Decision hierarchy:

1. failed quality gate loses;
2. materially worse retry/runtime failure profile loses;
3. authoritative same-window allowance evidence, when available, decides quality-adjusted subscription throughput;
4. otherwise attributable local/context reduction is reported as such and can justify an optional provider, but not a quota-efficiency claim.

Use conservative p75 costs once enough comparable receipts exist. Do not create a single composite "savings score" by mixing tokens, quota percentages and cost estimates.

## Delivery order

### Milestone A — tool deferral

- inventory native Claude/Codex tool/MCP deferral capabilities;
- define a provider-neutral `context-deferral` capability/evidence shape only if the native/provider implementations actually need one;
- implement the first safe path (prefer native when equivalent);
- add benchmark fixtures and integration tests;
- surface observed savings/coverage in the existing guided UI without a new daily workflow.

### Milestone B — broad context owner

- benchmark Context Mode versus Headroom and native compaction;
- select zero or one default provider;
- add lifecycle/telemetry support only for the winner;
- keep the other as unsupported/rejected-with-evidence rather than installing both.

### Milestone C — repeated work and retrieval

- evaluate Dejavu and repowise independently;
- admit each only for task classes where marginal benefit is measured;
- prevent them from becoming global default layers without evidence.

## Out of scope for this tranche

- bypassing provider subscription limits;
- browser/cookie quota scraping when a native/authenticated source exists;
- silently sending prompts to paid external APIs;
- comparing Claude quota percentage with Codex quota percentage directly;
- stacking multiple broad context compressors because each looks good in isolation;
- claiming subscription savings from `ccusage`, RTK, HarnessTrim or any other local token counter alone.

## Completion criteria

Phase 18.6 provider expansion is complete when:

1. at least one genuinely new context/output-saving mechanism has a covered implementation or a documented evidence-based rejection in favor of a native equivalent;
2. its marginal value is benchmarked against the existing Token Harness stack;
3. quality/retry outcomes are part of the verdict;
4. telemetry is attributable and privacy-preserving;
5. the guided experience can explain whether the mechanism is enabled, measured and beneficial without exposing advanced flags as the normal workflow;
6. CI/package/install smoke remains green across every claimed desktop OS.

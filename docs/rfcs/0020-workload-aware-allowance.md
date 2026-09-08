# RFC 0020 — Workload-aware allowance controller

Status: Accepted

Date: 2026-09-08

## Summary

Token Harness may accept an explicit remaining-work target, `--tasks-left N`, and compare that target with conservative empirical accepted-task capacity for the currently observed subscription allowance.

The target is user intent. It is never inferred from local token history, `ccusage`, provider percentages, task duration, or session count.

The controller answers one bounded question:

> Does the stated number of accepted tasks fit in the currently observed included allowance for this exact policy?

It does not forecast capacity after a future reset and it does not reverse-engineer a provider's billing or quota formula.

## Motivation

Five-hour and weekly pacing answer whether usage is ahead of or behind a linear allowance policy. They do not answer whether enough useful work remains possible before one of those windows becomes constraining.

Accepted-task capacity adds an outcome unit: successful tasks that passed the explicit quality gate. Workload awareness connects that empirical capacity to a caller-supplied backlog.

This makes the optimizer useful for decisions such as:

- keep the current policy because five remaining tasks fit safely;
- conserve because only two conservative task equivalents remain for five stated tasks;
- identify the five-hour window rather than the weekly window as the current bottleneck;
- consider another harness only when its own evidence says it can cover the same stated backlog.

## CLI contract

`--tasks-left N` is a positive whole number of accepted tasks.

It is available to the advanced optimization flow and to cross-harness scheduling. The same value can pass through `plan` and `apply` when native policy planning is requested, so a reviewed plan is derived from the same workload intent.

Examples:

```sh
token-harness optimize --harness codex --task standard --tasks-left 5
token-harness schedule --current codex --candidate claude --task-class standard --tasks-left 5
```

Without `--tasks-left`, historical behavior is preserved.

## Evidence boundary

Workload pressure may change policy only when accepted-task capacity is complete for the current exact policy boundary:

- same harness;
- same task class;
- same model;
- same reasoning effort;
- same verbosity;
- accepted quality outcome;
- comparable authoritative or reported backend quota deltas;
- at least three eligible recent samples for both included five-hour and weekly windows.

The capacity estimator keeps provider windows separate and uses the existing conservative p75 cost policy and configured reserve. Local token counts remain local workload evidence and are never converted into subscription allowance.

If exact-policy evidence is incomplete, workload coverage is `unknown`. The explicit target remains visible, but it cannot manufacture pressure or headroom.

## Coverage decision

For complete evidence, Token Harness compares the explicit backlog with whole conservative accepted-task equivalents.

The workload state is:

- `covered` — capacity is at least the stated backlog;
- `shortfall` — some capacity remains, but it is below the stated backlog;
- `exhausted` — conservative whole-task capacity is zero;
- `unknown` — the target exists but exact-policy capacity is not proven;
- `unavailable` — no explicit workload target exists.

The report includes the number of uncovered tasks and the limiting scope when it can be identified:

- `five-hour`;
- `weekly`;
- `tie` when both current task-equivalent estimates are equal;
- unknown when evidence is incomplete.

This is a statement about the currently observed windows only. No task capacity is carried across a reset that has not happened yet.

## Optimizer policy

A proven shortfall or exhaustion is a capacity-protection signal.

It may:

- turn quota-derived `use-headroom` behavior into `conserve`;
- suppress a quota-derived reasoning-effort increase;
- emit a first-priority recommendation to checkpoint, protect capacity, or consider another harness.

It may not:

- lower the task quality floor by itself;
- bypass outcome-learning quality gates;
- invent a cheaper model, effort, or verbosity without the existing policy evidence;
- redeem credits or buy paid API usage;
- alter authentication, endpoint, trust, or billing settings.

Existing `wait-for-reset` decisions remain stronger than workload pressure.

## Cross-harness scheduling

When a workload target is supplied, accepted-task capacity becomes required evidence for a workload-driven route.

The current harness is pressured when its proven conservative capacity is below the stated backlog. A candidate is considered workload-safe only when its proven capacity is at least the same backlog and the existing quality, pace, availability, and transfer-evidence rules also pass.

A candidate with unknown workload capacity does not receive a workload-driven switch recommendation. A candidate below the stated backlog is not selected merely because its raw pace looks better.

Without a workload target, the scheduler preserves the previous additive capacity behavior.

## Compatibility

The change is additive:

- old CLI invocations remain valid;
- old JSON consumers may ignore the new optional workload fields;
- old saved reports without workload data remain readable;
- provider quota percentages are still never compared directly across providers;
- no automatic harness launch or automatic switch is introduced.

## Validation

The milestone is covered by:

- domain tests for absent, unknown, covered, shortfall, exhausted, and limiting-scope decisions;
- budget-conservation tests;
- parser validation for positive whole-number targets;
- cross-harness routing tests where current and candidate capacity are compared with the same backlog;
- an end-to-end optimizer test using persisted project-local benchmark captures and receipts, proving that exact-policy empirical cost can produce a workload shortfall and conservation decision.

The release gate remains the repository's full Windows, macOS, and Ubuntu CI matrix.

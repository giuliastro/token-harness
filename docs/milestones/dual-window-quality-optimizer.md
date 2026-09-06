# Milestone: joint 5-hour / 7-day quality-preserving optimization

Date: 2026-09-06. Implementation: PR #175, branch
`feature/dual-window-quality-optimizer`. Contract: RFC 0014.

## Result

The optimizer now treats short-window capacity and the weekly allowance as
simultaneous constraints. One under-used window cannot cancel pressure in
another. This decision reaches both the existing Codex native configuration
planner and the existing Claude persistent-effort preference planner. No UI file
is modified, and no automatic task execution or session-level control is added.

The same input now produces one explainable decision for effort selection,
quota recommendations and additive JSON evidence. Cross-harness budget
hydration also protects the reserve rather than relying on the pacing deadband
alone. Explicit scheduler evidence retains its existing precedence.

## Concrete scenarios

With `--task hard --profile balanced --reserve 20`, a discovered catalog offering
`medium`, `high` and `xhigh`, no high context pressure, and fresh observations:

| Observation | Decision | Effort |
| --- | --- | --- |
| 5h: 20% used, reset in 30 minutes; weekly: 75% used, reset in 3 days | Conserve the weekly allowance | medium |
| Same 5h observation; weekly: 20% used, reset in 3 days | Use safe headroom on the hard task | xhigh |
| Same 5h observation; weekly unavailable | No quota-derived bonus | high |
| Both included windows exhausted | Checkpoint and recheck after the last observed exhausted reset | medium for a future task; no task is launched |

These are deterministic policy fixtures, not measured productivity or savings.
A high context-pressure signal can veto optional escalation. A critical task
never falls below the existing high-effort floor. Unsupported effort values are
never invented; a catalog unable to satisfy the floor yields no new value.

## Added evidence

`optimize --json` adds `harnesses[].budgetDecision` with the joint state,
`allowEffortIncrease`, `pressuredScopes`, `missingScopes`, `recheckAt` and reasons.
Existing fields and the schema-1 envelope remain available.

Each pace assessment additionally includes `bucketId`, `observationAgeMinutes`,
`spendableRemainingPercent` and `spendablePercentPerHour`. The last value is an
advisory allocation until reset, not an observed burn rate or an exhaustion
forecast. Short and weekly percentages are never summed or converted into
money, tokens or a shared balance across providers.

The controller rejects stale, future-dated, contradictory and cross-cycle
observations. Missing or duplicate/unmapped buckets cannot authorize a quota
bonus. Credit inventory neither authorizes more included usage nor triggers
automatic payment or reset-credit redemption.

## Using the existing safe workflow

```sh
token-harness optimize --task hard --profile balanced --reserve 20 --json
token-harness plan --native-policy --harness codex --task hard --profile balanced --reserve 20
token-harness plan --native-policy --harness claude --task hard --profile balanced --reserve 20
```

The first command only observes. The next two preview native policy changes.
Review the resulting plan and use the exact `apply --plan <id> --yes` command
printed by Token Harness to apply it. Existing version, ownership, drift,
verification and rollback guards still apply. Claude changes a persistent user
preference, not a proven active-session setting. A plan cannot silently change
models, authentication, endpoint, provider, billing or paid overflow.

## Validation

Local Node 22.16.0, Linux validation:

- 52 new regression/integration tests, including a 7,056-case property sweep over
  task class, profile and independently varied short/weekly usage.
- Full suite: 1,698 tests, 1,690 passed, zero failures, eight existing skips.
- Typecheck, ESLint, formatting, bundle build, bundle smoke, package staging and
  clean package-install smoke all passed.
- Native integration cases cover the real Codex planner and Claude
  plan/apply transaction with fake provider runners; Claude unrelated settings
  survive application. No signed-in account or paid task is exercised.

The PR's CI remains the source of truth for Windows, macOS and the minimum
supported Node 22.13.0 runtime. Check its final commit, not an earlier run.

## Development-plan status

This milestone advances PLAN 18.3 (joint pacing, reserve and quality-floor
correctness), 18.4 (both existing native planners consume the corrected policy)
and 18.7 (reserve-safe cross-harness budget hydration). RFC 0014 is the additive
contract; the existing phase/release gates are not relabeled complete.

Still open: quality-gated empirical task runs on signed-in Claude/Codex accounts,
failed-attempt/escalation learning, measured burn-slope forecasting, empirical
model-tier ranking, work-calendar-aware allocation, and opt-in runtime control.
This milestone makes no causal quota-saving percentage or monetary claim.

# RFC 0014 - Joint allowance and quality policy

- Status: Accepted for the advisory implementation in this branch
- Date: 2026-09-06
- Extends: RFC 0011, budget pacing and native effort recommendations

## Decision

Treat the five-hour and seven-day allowances as simultaneous constraints, not
interchangeable balances. An expiring five-hour window must never cancel weekly
pressure. A late-window pacing deadband must never authorize spending the
configured reserve. More effort is useful only for a task that benefits from it.

This is deterministic advisory policy. It does not execute coding tasks, purchase
or redeem credits, start sessions to activate windows, change billing, route
prompts, or introduce a background service. Existing explicit native
plan/apply/verify/rollback remains the only configuration mutation path.

## Evidence admission

Live pacing requires a native or reviewed companion observation, authoritative or
reported confidence, finite consistent percentages, positive finite duration,
valid timestamps and a reset that has not passed. Observations older than five
minutes or more than one minute in the future are not live policy evidence.
The observation itself must belong to the implied window, not an earlier cycle.
These freshness bounds are Token Harness policy, not a provider guarantee.

Cached, estimated, local-history, unknown-source and malformed snapshots remain
visible as unknown. Missing remaining percentage can be derived as 100 minus an
observed valid used percentage; contradictory supplied percentages are rejected.
A one-percentage-point tolerance admits independently rounded backend values.
Policy uses the conservative side of consistent rounded percentages.

Each pace assessment adds optional backward-compatible fields for backend bucket
identity, observation age, spendable remaining percentage, and spendable
percentage points per hour until reset. The latter is an advisory allocation:

    max(0, remainingPercent - reservePercent) / hoursToReset

It is not a measured burn rate or a forecast. Values from different windows or
harnesses are never added, subtracted, or converted to tokens, money, task counts
or a shared credit balance. Full time precision is used before display rounding.

## Joint decision

`HarnessOptimizationAdvice.budgetDecision` is additive. Its states are:

- `wait-for-reset`: an unambiguous observed included limit is exhausted. Preserve
  a checkpoint and re-observe after the latest of the observed exhausted resets;
  this timestamp does not guarantee that every other constraint is cleared.
- `conserve`: any live window is over pace or at/below the configured reserve.
  The task quality floor still applies. Another window cannot cancel pressure.
- `use-headroom`: a hard/critical task, one fresh five-hour and one fresh weekly
  observation, neither pressured nor at reserve, and under-used allowance near
  reset. Context pressure may still veto an effort increase.
- `balanced`: complete safe coverage without a reason for quota-driven escalation.
- `unknown`: incomplete, stale, malformed or unmapped evidence cannot justify
  extra spending. Keep the task-class policy without a quota-derived bonus.

Multiple same-scope buckets do not prove a model-to-bucket mapping. They may
conservatively constrain spending, but cannot authorize an increase or claim an
exact resumption time. Mixed-harness input is rejected. Additional unmapped
subscription limits block a headroom bonus. Paid credit inventory is never used
to authorize or restrict the included-allowance policy.

"Near reset" remains the existing advisory preference: at most one hour for the
five-hour window, or twelve hours for the weekly window. Both scopes must still
be safe. The reserve is user-selected and is not silently released at reset.

## Quality and compatibility

Native effort is selected exclusively from the discovered supported values.
Budget pressure cannot reduce a hard task below medium or a critical task below
high. If all ranked supported values are below the floor, no new value is
recommended. A current supported but unranked value may be preserved, never
invented or ranked by its name. Context cleanup precedes optional escalation.

The CLI uses the same joint decision for explanatory recommendations and effort
selection. Existing consumers keep the same command, envelope and configuration
transaction contracts; UI source files are out of scope. The cross-harness scheduler's
budget hydration also maps a live reserve breach/exhaustion to its existing
`over-pace` safety gate, with a distinct `budget-reserve-protected` reason when the
linear pacing deadband alone would have called the allowance healthy. Explicit
user-supplied scheduler evidence keeps its existing precedence.

## Validation and claims

Regression tests cover conflicting resets, incomplete coverage, reserve breaches,
multiple exhausted windows, malformed/stale/future/cross-cycle observations,
unknown buckets, credit separation, all task classes and supported catalogs.
Property sweeps verify that adding a pressured window cannot increase effort,
that order does not affect policy, and that outputs stay inside the supported
catalog and quality floor. Fixtures are contract evidence, not empirical claims
of percentage savings or improved task acceptance. Real signed-in quality-gated
A/B receipts are still required for a causal useful-work-per-quota claim.

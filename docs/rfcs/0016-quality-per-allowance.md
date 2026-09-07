# RFC 0016 - Quality per allowance

- Status: Accepted for this implementation
- Date: 2026-09-07
- Extends: RFC 0011, RFC 0014, RFC 0015

## Decision

Optimize reasoning-effort advice for **accepted task capacity**, not raw token volume and not raw provider percentages. A policy change may claim subscription-throughput benefit only when repeated project-local task outcomes have already cleared the quality/retry gates from RFC 0015 and exact-policy backend quota evidence shows a conservative improvement across the included five-hour and weekly windows.

Token Harness remains the policy authority. External tools may contribute read-only observations, but local token counters, cost estimates, cached quota snapshots, browser cookies and provider percentages are not interchangeable with subscription allowance. No percentage from Claude is compared with a percentage from Codex. Each harness is normalized independently into accepted-task equivalents before cross-harness scheduling or policy refinement.

## Accepted-task capacity

For one harness and task class, capacity uses recent successful project-local benchmark receipts with authoritative or reported backend quota deltas that remain comparable across the task boundary. The default evidence horizon is 14 days. Each included allowance window needs at least three positive comparable samples.

For each window, Token Harness uses the nearest-rank p75 observed quota cost per accepted task. This is deliberately conservative and is a Token Harness policy threshold, not a provider billing formula or statistical confidence claim. Zero backend movement never becomes a free task and local token counts are never converted into subscription quota.

The live spendable allowance is the existing pacing result after the configured reserve. Per-window accepted-task equivalents are:

`spendable remaining percent / p75 used percent per accepted task`

The reported whole-task capacity is the floor of the minimum across the included five-hour and weekly windows. Missing, stale, ambiguous, reset-crossing or non-authoritative quota evidence leaves capacity unknown instead of manufacturing headroom.

## Exact-policy identity

Capacity used to refine native reasoning effort must match the exact learned policy tuple:

- harness
- task class
- model
- reasoning effort
- verbosity

Base and candidate capacity must come from the same harness. An estimate missing the exact policy witness, or carrying a different task class/model/effort/verbosity, cannot refine the learned decision. This prevents model or verbosity changes from being credited to an effort change.

The general accepted-task estimator may still aggregate valid same-harness/same-task-class evidence for scheduling. Exact-policy refinement is intentionally stricter.

## Lower effort

A lower effort is considered only after RFC 0015 has already established that repeated outcomes do not regress quality or retries.

If exact-policy capacity is incomplete, the learned lower effort may remain the recommendation, but Token Harness makes no subscription-throughput claim.

If exact-policy capacity is complete, the candidate p75 backend quota cost must be non-worse than the base policy in **both** included windows and strictly better in at least one. Otherwise the base effort is kept. A five-hour improvement cannot hide a weekly regression and vice versa.

## Higher effort

Higher effort remains quality-first. Repeated evidence may justify escalation when it repairs quality or retry behavior. Exact capacity is not required to make the quality argument, but a measured zero whole-task capacity vetoes immediate escalation: Token Harness recommends checkpointing, waiting for reset or switching harness before spending more reasoning allowance.

Unknown capacity does not become a veto and does not become a throughput claim. The existing task quality floor, supported native catalog, reserve and dual-window budget policy remain mandatory.

## Optimizer and planner integration

`optimize` reuses the live budget snapshot and bounded project benchmark history it already observes. It performs no second external quota probe for quality-per-allowance.

Machine-readable recommendation evidence includes states such as:

- `allowance-throughput-improved`
- `allowance-no-throughput-gain`
- `allowance-capacity-unproven`
- `quality-recovery-with-capacity`
- `quality-recovery-no-capacity`
- `quality-per-allowance-capacity-mismatch`

A learned policy still enters the existing explicit native plan/apply/verify/rollback flow. For Codex, optimizer advice is frozen before the native configuration is re-observed, so the drift check is a real before/after guard rather than two concurrent snapshots. Configuration drift blocks the managed write.

## Privacy and safety

All learning remains bounded to current-project Token Harness benchmark state. No prompt, source code, browser cookie, provider credential or raw session content is required by the policy. External usage tools remain sensors only and do not gain mutation authority.

The implementation does not buy credits, redeem allowance, start tasks, switch models automatically, or claim that local token reduction equals subscription savings.

## Verification

The release gate is:

1. quality/retry gates remain authoritative;
2. five-hour and weekly evidence are evaluated independently;
3. exact policy identity cannot be mixed;
4. zero/unknown/stale quota cannot manufacture capacity;
5. native quality floors and supported effort catalogs remain intact;
6. planner drift protection remains fail-closed;
7. typecheck, lint, format, tests, build, bundle smoke and install smoke pass on Windows, macOS and Ubuntu.

The next optimization milestone may apply the same evidence discipline to verbosity: hold model and effort fixed, lower verbosity only after repeated no-regression outcomes plus improved backend allowance cost, and raise it only for demonstrated quality recovery.

# RFC 0017 - Verbosity quality per allowance

- Status: Accepted for this implementation
- Date: 2026-09-07
- Extends: RFC 0011, RFC 0015, RFC 0016

## Decision

Treat native verbosity as a separate learned control whose objective is successful work per included allowance. Model and reasoning effort stay fixed while verbosity is evaluated. The optimizer never attributes an outcome or backend-quota change to verbosity when either of those fixed controls changed.

This replaces the previous pressure-only verbosity downgrade. Economy profile, high context pressure, or an over-pace allowance is no longer sufficient evidence to change `medium` to `low`. Without project-local controlled evidence, Token Harness keeps the configured verbosity.

## Outcome learner

Verbosity learning uses the same bounded current-project benchmark history and stable start/finish policy boundary as outcome-aware effort. A candidate needs at least three distinct recent paired experiments, no contradictory or unknown candidate outcomes, no candidate quality failures, and no overlapping/reused run identity.

The recognized native verbosity levels in this implementation are `low`, `medium`, and `high`. A lower setting may become an outcome-safe candidate after repeated quality/retry no-regression evidence. A higher setting may become a candidate only when repeated quality or retry recovery supports the increase; lower local token volume or lower backend quota alone cannot justify raising verbosity.

Runtime/provider errors, malformed receipts, unstable configuration boundaries, unknown model/effort identity, and evidence from a different task class/harness/model/reasoning effort do not steer the policy.

## Lower verbosity

A lower verbosity has a stricter release gate than lower reasoning effort in RFC 0016. Outcome learning alone is not enough to change the setting.

Both the current and candidate exact-policy accepted-task capacity estimates must be complete. Their policy identity must match:

- harness;
- task class;
- model;
- fixed reasoning effort;
- respective verbosity.

The candidate p75 backend quota cost per accepted task must be non-worse in both the five-hour and weekly included windows and strictly better in at least one. If capacity is unknown/incomplete, if either window regresses, or if identity mismatches, the configured verbosity is kept.

This deliberately prevents local token savings from being presented as subscription-throughput savings.

## Higher verbosity

Higher verbosity is quality recovery, not an efficiency optimization. It requires repeated quality/retry evidence from the outcome learner. Exact accepted-task capacity may remain unknown without invalidating the quality argument, but a measured zero whole-task capacity vetoes immediate escalation. Token Harness then recommends checkpointing, rechecking/resetting allowance, reducing context, or switching harness before spending more allowance.

High context pressure and constrained/unknown joint allowance can defer the learned increase before the capacity refiner is reached.

## Single-control rule

Effort and verbosity are never learned in the same optimizer step. Verbosity learning runs only when:

- the captured model, reasoning effort, and verbosity are known and stable;
- the current reasoning effort is the captured effort;
- the final effort recommendation remains the current effort;
- effort outcome learning is neither applying nor deferring another change.

If effort changes, verbosity stays at its current value. A later benchmark cycle can evaluate verbosity against that new fixed effort.

## Optimizer and native planning

`token-harness optimize` exposes additive `verbosityLearning` evidence alongside the existing effort learning. The final verbosity recommendation includes both outcome and quality-per-allowance evidence.

Managed Codex planning re-observes the native model/effort/verbosity tuple after optimizer advice is frozen. A learned verbosity change is rejected when the model or fixed effort drifted, the current verbosity changed, the recommendation is outside `low|medium|high`, or an effort change is also being proposed. Existing version/digest/origin guards and rollback behavior remain unchanged.

## Privacy and measurement boundaries

No prompt, source code, transcript, cookie, OAuth token, API key, or external telemetry upload is required. Local token counts may help identify an outcome-safe lower candidate, but they never satisfy the backend allowance gate. Claude and Codex percentages are not compared directly; capacity normalization remains same-harness and exact-policy.

The implementation does not start tasks, purchase/redeem credits, choose a paid API route, or claim an unpublished provider token-to-quota formula.

## Verification

The milestone gate is:

1. three-pair minimum and stable policy boundaries;
2. model and reasoning effort fixed across verbosity evidence;
3. higher verbosity only for repeated quality/retry recovery;
4. lower verbosity requires complete exact-policy p75 improvement across both 5h and weekly windows;
5. incomplete/mismatched capacity keeps the current verbosity;
6. measured zero accepted-task capacity defers quality-recovery escalation;
7. effort and verbosity are never learned together;
8. native planning fails closed on post-advice drift;
9. typecheck, lint, format, tests, build, bundle smoke and install smoke pass on Windows, macOS and Ubuntu.

A later milestone may use these independently normalized effort/verbosity capacities as inputs to a joint Claude/Codex scheduler, but it must preserve single-harness evidence identity instead of comparing raw provider percentages.

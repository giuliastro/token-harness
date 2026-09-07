# Model quality-per-allowance milestone

Date: 2026-09-07

This milestone closes the advisory model-selection gap in `token-harness optimize` without widening the managed mutation surface.

## What changed

Token Harness can now learn one alternative native model from recent project-local paired benchmark receipts while reasoning effort and verbosity remain fixed. The candidate must be present in the current complete native catalog and must be supported by at least three distinct comparisons with no candidate quality failure, contradictory result, unknown candidate outcome, overlapping run, or reused run identity.

The model learner establishes outcome safety only. An efficiency-driven switch becomes a recommendation only after exact-policy accepted-task capacity is complete for both current and candidate models and the candidate p75 backend quota cost is non-worse in both the five-hour and weekly included windows and better in at least one. A quality-recovery candidate may use more allowance, but measured zero accepted-task capacity defers the recommendation.

Capacity identity includes harness, task class, model, reasoning effort, and verbosity. Cross-harness or mismatched-policy capacity is rejected.

## Single-control ordering

The optimizer now evaluates learned native controls in this order:

1. reasoning effort;
2. verbosity;
3. model.

Model learning runs only when effort and verbosity remain unchanged and neither earlier stage is applying or deferring another learned change. This keeps causal attribution understandable and makes later benchmark evidence reusable.

## What is deliberately not included

This milestone is advisory. It does not add `model` to the Codex `subscription-safe` write set and does not make `plan --native-policy` mutate the model.

The transaction layer already contains an apply-time `modelReference` resolver that can re-read `model/list`, reject truncated/missing/ambiguous catalogs, resolve a reviewed reference to one canonical model, and verify the native config write. Activating that path is a separate managed-policy milestone so optimizer evidence and mutation safety are reviewed independently.

No model name is interpreted as a cost/quality tier. Local tokens are not converted into subscription quota. Claude and Codex raw percentages are not compared directly. No paid API route, provider/auth change, service-tier change, or credit purchase/redemption is introduced.

## Validation target

The merge gate is the repository's complete Windows, macOS, and Ubuntu pipeline: install, typecheck, lint, format check, tests, build, bundle smoke, publishable-package staging, and install smoke. The final CI run and merge SHA are recorded in the pull request once complete.

# RFC 0018 - Model quality per allowance

- Status: Accepted for advisory implementation
- Date: 2026-09-07
- Extends: RFC 0011, RFC 0015, RFC 0016, RFC 0017

## Decision

Treat native model choice as the third independently learned optimizer control after reasoning effort and verbosity. Model learning runs only when effort and verbosity remain fixed at the observed policy. The objective is successful coding work per included allowance, not a guessed model tier, model-name heuristic, local-token minimum, or direct comparison of Claude and Codex percentages.

This milestone is advisory. `token-harness optimize` may recommend a different model when the evidence below is complete, but `plan --native-policy` does not translate that recommendation into a model write in this RFC. Managed model mutation requires a separate review of the existing apply-time native-catalog resolution path and its drift/rollback tests.

## Candidate discovery

Candidates come only from the current native model catalog. Names such as `mini`, `fast`, `pro`, or version numbers have no ordering or cost meaning in policy.

A model candidate requires at least three distinct recent project-local paired benchmark comparisons with:

- the same harness and task class;
- the same reasoning effort;
- the same verbosity;
- stable config-only policy identity at both task boundaries;
- no overlapping or reused run identity;
- no candidate quality failure, contradictory result, or unknown candidate outcome.

Malformed or incomplete history fails closed. A candidate absent from the current catalog cannot steer the recommendation. A truncated model catalog disables model learning for that observation.

## Outcome gate

The first stage establishes only that another model is outcome-safe or that it repeatedly recovers quality/retries. Quality and retry regressions lose before efficiency is considered.

Backend quota can support a paired win only when comparable same-window evidence exists. Local token volume may identify an outcome-safe candidate when quality and retries are non-regressing, but local tokens never become subscription quota and cannot make an efficiency-driven model switch actionable by themselves.

If the current model repeatedly fails and no proven alternative exists, model learning defers rather than selecting a model by name or catalog position.

## Allowance gate

An efficiency-driven switch requires complete exact-policy accepted-task capacity for both the current and candidate model. Evidence identity must match:

- harness;
- task class;
- model;
- fixed reasoning effort;
- fixed verbosity.

The candidate p75 backend quota cost per accepted task must be non-worse in both the five-hour and weekly included windows and strictly better in at least one. If either estimate is incomplete, either window regresses, or evidence identity mismatches, Token Harness keeps the current model.

A quality-recovery model may consume more allowance because avoiding repeated failed work is itself the quality objective. It still requires complete candidate capacity. A measured zero whole accepted-task equivalent vetoes the immediate switch and produces a defer/recheck recommendation.

## Single-control ordering

The optimizer evaluates controls in this order:

1. reasoning effort;
2. verbosity;
3. model.

Model learning runs only when neither previous stage is applying or deferring a change and both final recommendations remain at their observed values. A model recommendation therefore never co-occurs as a learned change with effort or verbosity in the same optimization step. After a model change is performed manually, a later benchmark cycle can learn effort or verbosity against that new fixed model.

## Native mutation boundary

Codex already exposes the ingredients required for a future managed model write: origin metadata for `model`, a versioned base-user config target, and a `modelReference` action contract whose executor re-resolves the reviewed model against `model/list` immediately before `config/batchWrite`.

This RFC deliberately does not activate that path. The current `subscription-safe` managed mutation remains limited to the already reviewed effort/verbosity slice. A follow-up must prove catalog completeness/uniqueness, post-advice model drift refusal, field-origin ownership, version preconditions, apply-time resolution, read-back verification, stored-plan behavior, and rollback before adding `model` to that write set.

## Privacy and measurement boundaries

No prompt, source code, transcript, cookie, OAuth token, API key, or remote telemetry upload is required. Model evidence is project-local benchmark metadata and bounded usage observations. Claude and Codex raw subscription percentages are never ranked against one another. Paid API routing, service-tier changes, credit purchase/redemption, and provider/auth changes remain outside this policy.

## Verification

The advisory milestone gate is:

1. minimum three paired comparisons with stable fixed effort and verbosity;
2. candidates restricted to the complete current native catalog;
3. quality/retry regressions veto candidates before efficiency;
4. efficiency switches require complete exact-policy p75 evidence for both 5h and weekly windows;
5. candidate is non-worse in both windows and better in at least one;
6. local tokens never satisfy the subscription allowance gate;
7. quality recovery is blocked when candidate accepted-task capacity is zero;
8. capacity from another harness or policy tuple is rejected;
9. effort, verbosity, and model are never learned as simultaneous changes;
10. typecheck, lint, format, tests, build, bundle smoke and install smoke pass on Windows, macOS and Ubuntu.

A subsequent RFC may activate catalog-resolved native model mutation. Cross-harness scheduling may consume independently normalized accepted-task capacity later, but must not derive a universal model score or compare provider percentages directly.

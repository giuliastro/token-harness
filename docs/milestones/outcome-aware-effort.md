# Milestone: outcome-aware native effort

Date: 2026-09-06. Branch: `feature/outcome-aware-effort-optimizer`.
Contract: [RFC 0015](../rfcs/0015-outcome-aware-effort.md).
Builds on merged PR #175 (joint five-hour / seven-day allowance policy).

## What now works

Token Harness can refine its task/budget effort recommendation from the project's
own controlled benchmark results. It can keep a successful lower effort instead
of spending more by default, or recognize when stronger reasoning has repeatedly
avoided unsuccessful attempts. This is a real input to both native planners, not
only another report. No UI source, model routing, account, billing or dependency
is changed.

The base recommendation still comes from the task class, profile, quality floor
and joint quota controller. A learned alternative needs at least three distinct,
non-overlapping paired experiments completed recently (within 14 days), with the
same harness, configured model, task class and verbosity. Only effort differs.
A failed candidate, contradictory results or unknown evidence veto the learned
change; ties do not count as wins. The smallest supported qualifying effort
change is preferred, not an invented ranking of model names.

## Deterministic examples

| Controlled evidence | Current conditions | Result |
| --- | --- | --- |
| Three hard-task pairs pass at high and medium; medium has at least 5% less local token volume without more attempts | Balanced; medium is in the discovered catalog and meets the floor | Recommend medium instead of the base high |
| Three standard-task pairs pass; medium requires three attempts, high one | Both allowance windows healthy | Recommend high instead of repeating the costly retry pattern |
| The same retry evidence | Weekly observation unavailable | Defer the learned increase and create no native effort/verbosity edit |
| Short-window quota delta improves, weekly delta worsens | Any profile | Reject the efficiency candidate rather than cherry-picking the short window |
| Favorable pairs plus a recent failed candidate task | Any profile | Do not adopt the candidate |
| The model, effort or verbosity changed at the end of an experiment | Any profile | Keep the task result, exclude it from stable-policy learning |

These are synthetic regression fixtures, not measured improvements in real
subscription usage. A local token win remains local evidence; an attempt count
remains an attempt count. Backend quota coordinates are checked independently,
never summed across windows or converted to money or common Claude/Codex credits.
Quality wins before efficiency, and current reserve/context constraints still
control whether a learned increase may be proposed.

## Capture and use

Use the existing capture commands around genuinely comparable tasks. For each
pair, keep the task, starting repository state, model, verbosity, provider setup
and quality gate controlled; only vary the explicitly chosen effort. Use separate
sessions/repository copies when needed to avoid one run benefiting from the
other's already-completed work. Do not run unrelated quota-consuming work during
a quota comparison. Token Harness does not run the task or select the experiment's
configuration for you.

```sh
token-harness benchmark-start --benchmark-id effort-trial-1 --variant baseline --harness codex --task hard
# Run the baseline task, then evaluate the declared quality gate.
token-harness benchmark-finish --benchmark-id effort-trial-1 --variant baseline --quality passed --attempts 1 --failed-attempts 0
# Restore a comparable starting state; explicitly select the alternative effort.
token-harness benchmark-start --benchmark-id effort-trial-1 --variant optimized --harness codex --task hard
# Run the optimized task and evaluate the same quality gate.
token-harness benchmark-finish --benchmark-id effort-trial-1 --variant optimized --quality passed --attempts 1 --failed-attempts 0
```

Use `--harness claude` for a Claude experiment. Repeat with at least three distinct
benchmark IDs; copied timestamps or renamed copies of one run are not independent
evidence. Record the actual quality and retry counts, including adverse runs.

```sh
token-harness optimize --harness codex --task hard --profile balanced --json
token-harness plan --native-policy --harness codex --provider none --task hard --profile balanced
```

Inspect the preview and apply only the exact stored plan with its printed
`apply --plan <id> --yes` command. The same path exists for Claude. Existing
approval, version, digest, origin, verification and rollback guards remain in
force. The planner additionally refuses a learned edit when the observed model,
effort, verbosity or supported catalog has changed since the recommendation.

## Consumer contract

`optimize --json` adds `harnesses[].effortLearning`:

- `state`: `unavailable`, `insufficient-evidence`, `kept`, `learned`, `deferred`;
- `baseEffort`, `recommendedEffort`, `candidateEffort`, configured `policy`;
- `minimumPairs`, `matchedReceipts`, `ignoredReceipts`, candidate outcome counts
  and explicitly separated evidence bases;
- `verification: config-only` and bounded explanations.

The existing recommendation fields already contain the refined result. A
`deferred` learned decision suppresses native effort and verbosity edits; it is
not a command that pauses or starts the user's running agent. No learned
alternative means the existing task/budget policy remains authoritative. That
policy may still preview an economical future preference after quota exhaustion,
without launching any work.

Schema-1 receipts add optional `policyAtFinish`. Legacy receipts retain their
existing reporting/comparison behavior but cannot steer learned effort without
this witness. A passed finish with every attempt marked failed is rejected.

Claude adds a separate `benchmarkPolicy` for an explicitly saved full `claude-*`
model and persisted effort under existing reviewed version/environment/hierarchy
conditions. Floating aliases and project overrides are not resolved or guessed.
The ordinary unobserved Claude `model` field is NOT overwritten with a saved
preference. Neither boundary observations nor a saved model prove the running
session's actual configuration.

## Safety and performance

Learning only reads existing project-attributed benchmark state. The reader caps
scans at 200 benchmark directories, 512 KiB per file and 8 MiB of evidence; an
oversized, changing, incomplete or corrupt relevant scan disables learning instead
of selecting favorable rows from a partial sample. In-progress captures without
receipts are normal; orphan completed receipts are not trusted. No prompts,
source code, session identifiers, raw paths or exception messages enter the
learning explanations. No new package, background service or network endpoint
is introduced.

## Validation

The automated suite covers pure policy, schema compatibility, bounded lineage
reads, Claude settings identity, and public CLI capture/optimize/plan/apply/rollback
for both harnesses. End-to-end fixtures verify approved single-field changes,
unchanged unrelated settings, exact rollback bytes, native model/verbosity drift,
missing weekly allowance, corrupt history and the config-only observation tier.
A 240-case property sweep checks order independence, supported catalogs and task
quality floors across profiles, task classes, budget states and context pressure.

All experiments in automated tests use synthetic provider responses and temporary
directories. They never run an authenticated coding task.

Local validation on Node 22.16.0 / Linux: **1,794 tests, 1,786 passed, zero
failures, eight pre-existing platform-specific skips**. This change adds **96
tests**, including the 240-case property sweep. Typecheck, ESLint, formatting,
bundle build, bundle smoke, package staging and clean package-install smoke all
passed. The PR's final commit CI is the source of truth for Windows, macOS and
the minimum supported Node 22.13.0 runtime.

## Remaining evidence, not hidden assumptions

No empirical percentage of credits saved or real task-acceptance improvement is
claimed. Configuration-boundary readings cannot detect arbitrary mid-task changes,
provider/model remapping, session overrides or unrelated account usage. Real
quality-gated signed-in experiments are needed to establish benefit. Automatic
runtime control, empirical model-tier ranking, work-calendar allocation and
measured burn-rate forecasts remain separate work in PLAN.

# RFC 0015 - Outcome-aware native effort

- Status: Accepted for this implementation
- Date: 2026-09-06
- Extends: RFC 0011 sections 18.3, 18.5 and 18.6; RFC 0014

## Decision

Refine the existing task/budget effort recommendation using recent, project-bound
baseline/optimized receipts. The objective is accepted work, not a smaller token
counter at the expense of quality or repeated attempts. This is deterministic,
read-only learning; configuration still requires the existing explicit native
plan/apply/verify/rollback flow. No task, background agent, credit redemption,
model switch, paid route, or external telemetry service is added.

A recommendation needs three distinct, non-overlapping paired experiments in the
last 14 days, for the same harness, explicitly configured model, task class and
verbosity. Only effort differs. Every counted comparison must support the same
candidate, with no contrary or unknown result. Known ties do not count as wins.
A recent failed candidate receipt vetoes that candidate even if it is unpaired.
Runtime/provider errors cannot justify an effort escalation. Copied run identities,
conflicting duplicate receipts, and partial/over-budget reads cannot manufacture
support. These are policy thresholds, not a statistical confidence claim.

Quality wins first. With both tasks passed, more failed attempts or total attempts
veto a candidate even when a quota counter is smaller. Comparable observed quota
windows are checked independently: a regression in either observed window vetoes
an efficiency win. Fewer retries are separate evidence; local token-volume wins
need at least five percent improvement and consistent counters. They are never
called subscription savings. No percentages are summed across windows or tasks.

## Capture and attribution

Schema 1 receipts gain optional `policyAtFinish` (model, effort, verbosity,
`verification: config-only`). `benchmark-finish` reads configuration again. Old
receipts remain valid for existing reports, but cannot steer learned policy.
Learning requires matching start/end policy and capture/receipt lineage including
benchmark directory, variant, project, task, harness, model, effort, verbosity,
start timestamp and original quota observations. Changes at a boundary invalidate
policy attribution, not the user's task outcome.

These are configuration-boundary observations, NOT continuous active-session
control. Session overrides, model remapping, provider changes, task difficulty,
cache effects and unobserved mid-task changes remain confounders. For meaningful
experiments the user must keep them controlled and validate the final result.

Claude's effective session model is not exposed by the current adapter. An
additive `benchmarkPolicy` observes only a full `claude-*` model explicitly saved
in the reviewed user's settings alongside the persisted effort. The same
version/environment/hierarchy/digest gates apply; a project model override,
alias, changing file or unknown policy leaves identity unknown. `context.model`
remains unchanged, and no default/alias is resolved or model selected. This makes
Claude's evidence useful without mislabeling a saved choice as a runtime fact.

## Interaction with the existing policy

The existing quality floor and discovered supported catalog are mandatory.
Economy/balanced/custom can adopt a repeatedly successful lower-effort setting.
Quality keeps its requested effort rather than learning an efficiency-only
downgrade. A higher effort must have demonstrated better quality or fewer retries,
not just a smaller local token count, and requires independently healthy five-hour
AND weekly windows. Unknown/pressured/exhausted quota or high context pressure
instead asks for a checkpoint, context review or reset recheck. It never overrides
the reserve or the task quality floor. Two recent failures with no passed result
at the proposed effort suppress that proposal rather than repeating a failed
cheap strategy. A deferred decision produces no effort or verbosity mutation.
A learned effort keeps verbosity unchanged so two policy changes are not conflated.
Without an eligible learned alternative, the existing task/budget policy still
applies, including its ability to preview an economical preference for a future
task after an exhausted window. No command starts that task.

`optimize --json` adds `harnesses[].effortLearning`: state, base/recommended/candidate
effort, the observed configuration identity, sample counts, candidate verdicts and reasons. Existing command names,
flags and envelope version stay unchanged. No UI source is edited. The native planner rechecks the learned model/effort/verbosity
tuple and supported effort catalog before proposing an edit; drift blocks that
proposal. Existing apply-time version/digest and rollback checks remain in force.

## Resource and privacy boundaries

Read only the current project's existing Token Harness benchmark directory, using
injected filesystem ports. Inspect at most 200 benchmark directories, 512 KiB per
file and 8 MiB total. No state or salt is created by learning. Missing history is
ordinary absence; corrupt, inaccessible, changing or oversized relevant evidence
makes learning unavailable rather than hiding potentially adverse results. No
receipt path, prompt, session id, source code or exception text enters learning
reasons. Pure policy, reader, parser, native-plan and rollback tests use synthetic
fixtures and temporary directories, never signed-in provider accounts.

## Verification and remaining work

The release gate is deterministic policy correctness plus integration with both
existing native planners and the unchanged approval/rollback controls. It is not
a claim of measured subscription savings. Real controlled signed-in experiments,
continuous task-policy telemetry, adaptive models, automatic task execution,
work-calendar pacing and burn-rate forecasting remain separate milestones.

Sources checked 2026-09-06:

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Claude Code cost management](https://code.claude.com/docs/en/costs)
- [Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)

These sources distinguish saved/session model choices and included allowance from
API/token-based billing. They do not validate this policy's empirical benefit.

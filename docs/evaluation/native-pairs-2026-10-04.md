# Native Windows paired pilot — 2026-10-04

Six same-task pairs produced twelve accepted code changes. These recordings do **not** establish
general savings: four optimized trials used more local tokens and five took longer. The three
optimized Codex trials also failed both attempts to execute their RTK-rewritten `git diff --stat`.
They are failed combined-stack comparisons even though the generated code passed acceptance.

## Results

| Harness / class | Baseline local tokens | Optimized local tokens | Baseline seconds | Optimized seconds | Code acceptance / provider execution |
| --- | ---: | ---: | ---: | ---: | --- |
| Claude / mechanical | 29,730 | 39,417 | 13.534 | 15.607 | 24/24 tests in each; provider commands succeeded |
| Claude / standard | 44,862 | 43,948 | 20.168 | 25.333 | 29/29 in each; provider commands succeeded |
| Claude / hard | 51,364 | 49,383 | 35.763 | 39.069 | 31/31 in each; provider commands succeeded |
| Codex / mechanical | 89,994 | 106,350 | 37.953 | 64.176 | 24/24 in each; optimized RTK command failed twice |
| Codex / standard | 94,247 | 112,329 | 51.394 | 74.997 | 29/29 in each; optimized RTK command failed twice |
| Codex / hard | 104,374 | 124,674 | 133.017 | 122.664 | 31/31 in each; optimized RTK command failed twice |

Tokens are the native CLI's input/cache/output counters, including cache reads, within each harness.
They are not quota currency or a cross-harness cost ranking. Codex reports cached input as a subset
of input; the sanitized receipt subtracts that subset before storing the separate input bucket.
Claude exposes input, cache creation, cache read and output separately. Wall time covers the native
CLI invocation, excluding budget reads and the independent grader.

Every trial had one native acceptance-test call and zero failed acceptance calls. The two failed
Codex shell attempts are retained separately; they are not silently counted as successful execution
or omitted just because the final CLI process returned zero. Every frozen test hash survived.

## Activation, allowance and scope

Native versions and the exact local tarball hash are in [the fingerprint](results/2026-10-04-fingerprint.json).
Claude reported root model `claude-opus-5-5`. Codex was invoked with the default `gpt-5.6-sol` from
its native RPC catalog; this is a supported invocation setting, not reported child-model telemetry.
Both variants used the same task effort: low, medium or high respectively.

All six baseline prompt-counter deltas were zero; every optimized delta was one. No child was
requested by these workloads. The experiment measured the joint RTK + HarnessTrim + routing
profile, not the marginal benefit of routing or delegation. No model identity is inferred from a hook.
HarnessTrim's actual per-project receipts, including unchanged outputs, remain separate character
observations in [the sanitized data](results/2026-10-04-native-pairs.json).

Codex's five-hour and weekly account readings came from the authoritative native RPC source, but
the parent Codex chat was active on the same account. Their task attribution is unavailable. The
audit preserves both window snapshots as account observations and removes them from the task
comparison's `usageBefore`/`usageAfter`. Claude's authoritative windows were unavailable. Billed
API cost is null for both; Claude's list price estimate is retained under its own label.

One trial per profile/class, variable cache state and fixed order cannot establish repeatable savings
or statistical confidence. Standard ran optimized first; mechanical/hard ran baseline first. Root
instructions and the native harness environment were inherited equally by both variants. These
limits, the Codex activation failures and the latency increases veto a broad positive claim.
README statistics and compatibility rows were not changed.

## Reproduce the workload and audit

The [fixture generator](../../scripts/evaluation/paired-native-fixtures.mjs) exports the exact initial
source, objective, effort and acceptance tests. Create a **new** project per class/profile, record
their hashes, initialize Git and commit only `solution.mjs` and `acceptance.test.mjs`. Do not run in
the working source checkout. After recording the result, `git restore --source=HEAD -- solution.mjs`
restores the seed without changing user configuration or removing recordings.

Use the objective with this identical suffix for each pair:

> Work only in this directory. Modify only solution.mjs; do not edit acceptance.test.mjs. Run these
> literal commands, without rtk/harnesstrim prefixes, pipelines, filters or redirection:
> node --test --test-reporter=tap acceptance.test.mjs and git diff --stat. Do not use subagents,
> network or install software. Report the test result briefly.

For Codex 0.146.0 the recorded command was `codex exec --sandbox workspace-write
--skip-git-repo-check --model <native-catalog-model> -c model_reasoning_effort=\"<effort>\"
--json <prompt>`. Only the baseline added `--disable hooks`. Global settings and trust were not
changed between variants. Preserve this sandbox when reproducing these failures; a later full-access
canary is a different experiment.

For Claude the recorded flags were `--print --tools Bash,Read,Edit,Write --allowedTools Bash Read Edit
Write --permission-mode acceptEdits --setting-sources project --settings <private-profile.json>
--effort <effort> --output-format stream-json --verbose --include-hook-events --max-turns 16`.
Both private files copied the same existing settings; the baseline removed only Token Harness,
RTK and HarnessTrim hooks. The optimized file retained them. Keep these settings snapshots private;
they can contain user paths and credentials. Do not replace the global settings file.

Retain native stdout/stderr, `budget-before.json`/`budget-after.json`, callback counts, monotonic CLI
wall time, an independently run `node --test --test-reporter=tap acceptance.test.mjs`, and final source
and test hashes in each `<harness>-<class>/<variant>` directory. The original private runner's
`receipt.json` and `protocol.json` fields are visible in the audited data and the read-only script.
The audit rechecks native usage totals, native tool failures, unchanged test hashes and independent
validation before producing public data. It launches no coding agent or package installer.

```powershell
node scripts/evaluation/audit-native-pairs.mjs --input artifacts/paired-native-2026-10-04 `
  --fingerprint docs/evaluation/results/2026-10-04-fingerprint.json
# Preview is the default. To retain a sanitized copy in a new file, add:
# --output artifacts/reviewed-pairs.json --apply
```

The published data preserves hashes of the original private stream, receipt, protocol and independent
grader output. It contains no transcript, authentication data, settings snapshot or personal path.
Raw evidence remains in the local artifact directories for review.

## Later repair and remaining gate

The failed Codex commands exposed a real PATH assumption. The subsequent Windows launcher pins
the observed Token Harness script and RTK executable and passes their encoded paths through Node.
A genuine Codex full-access canary then executed RTK successfully. In `workspace-write`, the native
sandbox cannot read this user's global npm script under the profile; its failure is retained separately.
No persistent sandbox policy or trust setting was changed to obtain the positive canary.

Issue #360 remains open for isolated task-attributable allowance measurements, successful matched
Codex stack activation, repetition and marginal routing value. Issue #359's native Linux follow-up
is explicitly deferred by the user. These are evidence gates, not a reason to relabel failed trials.

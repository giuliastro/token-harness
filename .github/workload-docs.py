from pathlib import Path

readme = Path('README.md')
text = readme.read_text()
marker = '## Workload-aware allowance planning\n'
if marker not in text:
    anchor = '## Applying native recommendations\n\n`optimize` remains read-only.'
    if text.count(anchor) != 1:
        raise SystemExit(f'expected one README anchor, got {text.count(anchor)}')
    section = '''## Workload-aware allowance planning

If you know how many accepted tasks remain, the advanced CLI can ask whether that backlog fits the
**currently observed** included allowance:

```sh
token-harness optimize --harness codex --task standard --tasks-left 5
token-harness schedule --current codex --candidate claude --task-class standard --tasks-left 5
```

`--tasks-left` is explicit workload intent. Token Harness does not infer it from `ccusage`, local
tokens, session length, or raw provider percentages. A workload-driven recommendation requires
complete project-local benchmark evidence for the exact model + reasoning effort + verbosity policy
in both the five-hour and weekly windows. If that evidence is incomplete, capacity stays unknown.

When evidence proves that the current policy cannot cover the stated backlog, `optimize` protects
capacity instead of spending a quota-derived effort bonus and reports whether the five-hour,
weekly, or both windows are limiting. `schedule` can use the same target to consider the other
harness, but only when that candidate has enough conservative accepted-task capacity and passes the
existing quality, pace, availability, and transfer checks.

No capacity after a future reset is assumed. Re-run the observation after the reset rather than
treating a forecast as provider quota. See [RFC 0020](docs/rfcs/0020-workload-aware-allowance.md).

'''
    text = text.replace('## Applying native recommendations\n', section + '## Applying native recommendations\n', 1)
    readme.write_text(text)

plan = Path('PLAN.md')
plan_text = plan.read_text()
heading = '## Workload-aware allowance milestone (2026-09-08, RFC 0020)'
if heading not in plan_text:
    addition = '''

## Workload-aware allowance milestone (2026-09-08, RFC 0020)

**Phase 18.11 complete.** `optimize`, native-policy planning and the cross-harness scheduler can now
accept an explicit `--tasks-left N` backlog without inferring work from local token history. The
controller compares that target only with conservative project-local accepted-task capacity for the
exact harness/task/model/effort/verbosity boundary and requires complete five-hour plus weekly
backend quota evidence before it can create pressure or headroom.

A proven shortfall suppresses quota-derived effort escalation without weakening the task quality
floor, reports the uncovered task count and identifies the five-hour, weekly or tied limiting scope.
Cross-harness routing may use the same backlog, but a candidate with unknown or insufficient
accepted-task capacity is not selected merely because its raw pace looks better. No future-reset
capacity, paid overflow, token-to-quota conversion or automatic harness switch is introduced.

Acceptance completed:

- explicit positive whole-number workload target in the shared CLI and schedule surface;
- exact-policy five-hour/weekly capacity gating with p75 empirical accepted-task cost and reserve;
- covered, shortfall, exhausted and unknown workload states with limiting-scope evidence;
- optimizer conservation and no quota-derived escalation when the stated backlog is not covered;
- cross-harness routing tests for current shortfall, candidate coverage and candidate insufficiency;
- end-to-end persisted benchmark test proving a five-task backlog can become a measured
  five-hour-limited shortfall;
- legacy behavior preserved when `--tasks-left` is absent;
- RFC/README contract stating that local tokens and future resets are not subscription capacity.

Next optimization work should build on this outcome unit rather than raw provider percentages:
prioritize mixed task-class workload composition and workload allocation across Claude/Codex only
after enough per-class empirical receipts exist to keep those decisions evidence-backed.
'''
    plan.write_text(plan_text.rstrip() + addition + '\n')

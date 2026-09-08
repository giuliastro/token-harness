# RFC 0021 — Mixed task-class workload allocation

Status: implemented milestone candidate

## Summary

RFC 0020 made included-allowance planning workload-aware for one explicit task class. This RFC adds
an explicit mixed backlog for queued or new work, for example:

```sh
token-harness schedule --current codex --candidate claude \
  --workload mechanical=2,standard=3,hard=1
```

The allocator answers a narrower question than a general agent orchestrator: given the currently
observed five-hour and weekly allowance plus project-local quality-gated benchmark receipts, how
much of this stated class mix can conservatively fit on the two supported harnesses?

It remains advisory. It does not launch Claude or Codex, move an in-progress session, redeem paid
credits, change authentication, or assume capacity after a future reset.

## Why a separate mixed-workload mode

`--tasks-left N --task <class>` intentionally treats all remaining work as one class. Summing
per-class `acceptedTasksRemaining` values to model a mixed backlog would be wrong because every
class on one harness consumes the same five-hour and weekly allowance buckets.

Mixed allocation therefore works from the underlying empirical p75 cost of one accepted task in
each class and accumulates those costs against the same spendable allowance for that harness.
Whole-task capacity for one class is never treated as an independent bucket from another class.

## CLI contract

Mixed mode uses a compact comma-separated class/count list:

```text
--workload mechanical=2,standard=3,hard=1
```

Rules:

- valid classes are `mechanical`, `standard`, `hard`, and `critical`;
- every count is a positive safe integer;
- a class may appear only once;
- at most 10,000 total tasks are accepted to keep the advisory allocator bounded;
- `--current` and `--candidate` must still name Claude and Codex explicitly.

Mixed mode represents queued/new tasks. It is mutually exclusive with single-task workload flags,
manual pace/quality evidence, and handoff/transfer evidence. Those inputs describe a different
question and are not silently blended.

The historical single-task `schedule --task-class ... [--tasks-left ...]` path remains unchanged.

## Evidence boundary

For each demanded task class and harness, Token Harness estimates capacity using the existing
accepted-task estimator:

1. project-local receipts only;
2. the exact harness and task class;
3. quality gate passed;
4. recent evidence only;
5. positive, comparable backend quota deltas;
6. at least three samples for both five-hour and weekly windows;
7. nearest-rank p75 cost per accepted task;
8. fresh authoritative/reported live allowance with the normal reserve.

The current harness may use that quality-passed capacity directly. Candidate assignments require an
additional class-attributed quality check: at least three coherent known observations must all pass.
A failed candidate class is ineligible; conflicting, missing, or undersampled quality remains
unknown.

Unknown evidence never becomes zero cost or a guessed switch.

## Shared-window accounting

For each harness, the allocator tracks two independent used amounts:

- five-hour used percent required by the proposed allocation;
- weekly used percent required by the proposed allocation.

Placing one task adds that class's empirical p75 cost to both counters. A placement is legal only if
both counters remain within that harness's currently spendable allowance. This preserves the two
real constraints instead of collapsing them into a provider-neutral percentage.

Claude percentages are never subtracted from Codex percentages and no local-token-to-subscription
quota conversion is introduced.

## Allocation policy

The first implementation is deterministic and conservative, not a claim of globally optimal bin
packing.

At each step it:

1. considers classes with remaining demand;
2. prioritizes classes with fewer currently feasible harnesses so constrained work is less likely to
   be stranded;
3. among equally constrained classes, prioritizes higher normalized allowance cost;
4. chooses the feasible harness that yields the lowest prospective peak utilization across that
   harness's own five-hour and weekly spendable allowance;
5. prefers the current harness on an exact tie to avoid a gratuitous switch.

The result is one of:

- `stay`: all evidenced work fits on the current harness;
- `switch`: all evidenced work is assigned to the candidate;
- `split`: both harnesses are needed and all work fits;
- `shortfall`: all relevant evidence is known but combined current allowance cannot cover the mix;
- `insufficient-evidence`: some unallocated work depends on missing/ambiguous capacity or quality
  evidence.

Unallocated tasks are always reported explicitly.

## Privacy and safety

Mixed allocation reads the same project-local benchmark receipts and live allowance observations
already used by Token Harness. It does not persist prompts, source code, credentials, or raw harness
transcripts. The workload list contains only task classes and counts.

No background execution, automatic harness launch, paid overflow, authentication/provider change,
or service-tier mutation is added by this RFC.

## Non-goals

This milestone does not:

- infer a task mix from GitHub issues, local token history, or conversation content;
- forecast capacity after a provider reset;
- optimize an in-progress cross-harness handoff;
- claim a global optimum across arbitrary future tasks;
- compare raw Claude and Codex quota percentages;
- choose model/effort/verbosity jointly across both harnesses inside the allocator.

Those can be evaluated later only if they preserve the same evidence and quality boundaries.

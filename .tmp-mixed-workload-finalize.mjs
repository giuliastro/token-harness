import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const text = fs.readFileSync(path, 'utf8');
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected exactly one replacement anchor`);
  }
  fs.writeFileSync(path, text.slice(0, first) + after + text.slice(first + before.length));
}

replaceOnce(
  'apps/cli/src/schedule-mixed-workload.ts',
  '  TASK_CLASSES,\n',
  '',
);

const readmePath = 'README.md';
const readme = fs.readFileSync(readmePath, 'utf8');
const readmeStart = readme.indexOf('## Workload-aware allowance planning\n');
const readmeEnd = readme.indexOf('\n## Applying native recommendations', readmeStart);
if (readmeStart < 0 || readmeEnd < 0) throw new Error('README workload section anchors not found');
const readmeSection = `## Workload-aware allowance planning

If you know how many accepted tasks remain, the advanced CLI can ask whether that backlog fits the
**currently observed** included allowance:

\`\`\`sh
token-harness optimize --harness codex --task standard --tasks-left 5
token-harness schedule --current codex --candidate claude --task-class standard --tasks-left 5
\`\`\`

\`--tasks-left\` is explicit workload intent for a backlog of one task class. Token Harness does not
infer it from \`ccusage\`, local tokens, session length, or raw provider percentages. A workload-driven
recommendation requires complete project-local benchmark evidence for the exact model + reasoning
effort + verbosity policy in both the five-hour and weekly windows. If that evidence is incomplete,
capacity stays unknown.

When evidence proves that the current policy cannot cover the stated backlog, \`optimize\` protects
capacity instead of spending a quota-derived effort bonus and reports whether the five-hour,
weekly, or both windows are limiting. \`schedule\` can use the same target to consider the other
harness, but only when that candidate has enough conservative accepted-task capacity and passes the
existing quality, pace, availability, and transfer checks.

### Mixed task-class backlog

For queued **new tasks** spanning more than one class, give \`schedule\` the mix explicitly:

\`\`\`sh
token-harness schedule --current codex --candidate claude \\
  --workload mechanical=2,standard=3,hard=1
\`\`\`

Mixed mode does not sum per-class task capacities as if they were separate quota buckets. It charges
each proposed task's project-local p75 cost against the same shared five-hour and weekly allowance
of that harness, then returns \`stay\`, \`split\`, \`switch\`, \`shortfall\`, or
\`insufficient-evidence\`. Candidate assignments require at least three coherent quality-gated
observations for the exact task class plus complete five-hour and weekly capacity evidence.
Unproven work remains visibly unallocated.

This mode is for queued/new tasks, not an in-progress handoff. Therefore \`--workload\` is mutually
exclusive with \`--task-class\`, \`--tasks-left\`, manual pace/quality flags, and handoff/transfer
flags. The allocator is deterministic and conservative; it does not claim globally optimal routing,
launch either harness, or compare raw Claude and Codex percentages.

No capacity after a future reset is assumed. Re-run the observation after the reset rather than
treating a forecast as provider quota. See [RFC 0020](docs/rfcs/0020-workload-aware-allowance.md)
and [RFC 0021](docs/rfcs/0021-mixed-workload-allocation.md).
`;
fs.writeFileSync(
  readmePath,
  readme.slice(0, readmeStart) + readmeSection + readme.slice(readmeEnd),
);

const planPath = 'PLAN.md';
const plan = fs.readFileSync(planPath, 'utf8');
const oldTail = `Next optimization work should build on this outcome unit rather than raw provider percentages:
prioritize mixed task-class workload composition and workload allocation across Claude/Codex only
after enough per-class empirical receipts exist to keep those decisions evidence-backed.
`;
const newTail = `Next optimization work should build on this outcome unit rather than raw provider percentages:
prioritize mixed task-class workload composition and workload allocation across Claude/Codex only
after enough per-class empirical receipts exist to keep those decisions evidence-backed.

## Mixed task-class workload allocation milestone (2026-09-08, RFC 0021)

**Phase 18.12 complete.** The installed \`schedule\` surface now accepts an explicit mixed backlog
such as \`--workload mechanical=2,standard=3,hard=1\` for queued/new tasks while preserving the
historical single-task scheduler unchanged.

The allocator does not add per-class whole-task capacities, because those classes share the same
provider allowance. Instead it accumulates each class's project-local p75 accepted-task cost against
the harness's shared spendable five-hour and weekly windows and admits a placement only when both
constraints still fit. Claude and Codex percentages remain independent observations rather than a
provider-neutral currency.

Candidate placements require at least three coherent quality-gated observations for the exact task
class as well as complete accepted-task capacity evidence. Missing or conflicting evidence leaves
work unallocated. Known combined-capacity exhaustion reports a shortfall instead of forecasting a
future reset.

The first allocator is deterministic and conservative: constrained/high-cost classes are placed
first, then each task goes to the feasible harness with the lowest prospective peak utilization,
with an exact tie preferring the current harness. The result is explicitly \`stay\`, \`split\`,
\`switch\`, \`shortfall\`, or \`insufficient-evidence\`; it is not presented as globally optimal bin
packing.

Mixed mode deliberately excludes handoff, transfer-benefit, manual pace, and manual quality flags.
It does not launch a harness, move an active session, redeem paid credits, change provider/auth, or
infer task composition from source code, GitHub issues, or local token history. README and RFC 0021
document the public contract.

Next optimization work should use the observed allocation receipts to improve per-class capacity
confidence and only then consider richer joint model/effort/verbosity allocation across harnesses.
`;
if (!plan.includes(oldTail)) throw new Error('PLAN Phase 18.11 tail anchor not found');
fs.writeFileSync(planPath, plan.replace(oldTail, newTail));

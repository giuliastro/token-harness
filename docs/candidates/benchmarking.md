# Candidate benchmark workflow

Token Harness evaluates candidate optimizers against the user's **actual current stack**, not against
an artificially bare Claude Code or Codex setup. Candidate benchmarking is evidence collection only:
it does not install, enable, disable or configure Headroom, mcptoon or GitNexus.

The benchmark sidecar records which candidate the experiment targets. That label is not proof that
the candidate was active. The person or automation running the experiment must establish candidate
activation separately and keep the task conditions comparable.

## Guided campaign

For a repeatable evaluation across task classes, use `benchmark-matrix` in campaign mode by supplying
a campaign prefix through `--benchmark-id` together with an explicit candidate and harness:

```text
token-harness benchmark-matrix --benchmark-id gitnexus-eval --candidate gitnexus --harness codex
```

The standard campaign contains two paired runs for each task class: mechanical, standard, hard and
critical. That is eight baseline/optimized pairs in total. Add `--task <class>` to focus on the two
pairs for one class while keeping the same deterministic naming scheme.

Campaign mode writes **no separate campaign manifest**. Planned benchmark ids are derived from the
campaign prefix (`gitnexus-eval-m-1`, `gitnexus-eval-m-2`, `gitnexus-eval-s-1`, and so on), and
progress is reconstructed from the normal immutable benchmark captures, receipts and candidate
attribution sidecars. Rerun the same `benchmark-matrix` command at any time to resume.

The report gives one next action. For an untouched slot it prints the exact baseline `benchmark-start`
command. After the baseline is complete it tells the evaluator to enable the candidate through the
candidate project's own documented workflow before starting the optimized side. It never claims that
activation was proved. A partially running capture is resumed with the matching `benchmark-finish`
command. If a slot contains wrong-project, wrong-harness, wrong-task, wrong-candidate or malformed
state, the campaign stops instead of overwriting or guessing.

Campaign evidence is aggregated only from completed planned pairs and remains separate by evidence
class. Completion itself is not a promotion recommendation and no synthetic winner score is created.

## One paired experiment

Choose one stable benchmark id, task class and harness. Run both variants from the same project.
For example, to evaluate Headroom on a standard Codex task:

```text
token-harness benchmark-start --benchmark-id headroom-standard-1 --candidate headroom --variant baseline --task standard --harness codex
```

Run the task with the normal current stack, then close the baseline capture using the exact
`benchmark-finish` command Token Harness prints. Record the real quality result and attempt counts;
do not mark a failed task as passed merely because it used fewer tokens.

After the baseline is closed, enable the candidate using the candidate project's own documented
workflow. Token Harness deliberately does not do that during candidate evaluation. Then start the
optimized side of the same experiment:

```text
token-harness benchmark-start --benchmark-id headroom-standard-1 --candidate headroom --variant optimized --task standard --harness codex
```

Run the same task under comparable conditions and close the optimized capture with the printed
`benchmark-finish` command.

Finally review the project evidence:

```text
token-harness benchmark-matrix --harness codex --task standard
```

The human output groups candidate evidence separately for Headroom, mcptoon and GitNexus. JSON keeps
the same evidence available for automation.

## What must stay comparable

Keep the project, harness, task intent and quality gate stable across the pair. Avoid changing model,
reasoning effort, verbosity or unrelated optimizer configuration between the two sides unless that
change is the explicit experiment. Do not run unrelated concurrent work when local session
attribution matters: multiple changed sessions make local usage ambiguous by design.

The baseline is the native/current managed stack already in use, including RTK and HarnessTrim when
they are active. The optimized run adds only the candidate being evaluated. This is what makes the
result a marginal-value test rather than a marketing benchmark.

## Evidence interpretation

Quality is evaluated before efficiency. Backend allowance evidence is used only when the existing
paired comparator can establish trustworthy same-window movement. Local token volume stays local
evidence. Wall-clock deltas are reported only for quality-passed pairs and do not become a quota or
billing claim.

A single attractive pair is not a promotion decision. Repeat representative workloads and task
classes. The scorecard intentionally emits no composite score or automatic winner because promotion
also depends on coverage, distinctness, operational cost, compatibility, activation verification and
reversibility.

## Candidate-specific setup

Use `--candidate headroom`, `--candidate mcptoon` or `--candidate gitnexus` to attribute a pair.
Candidate-specific activation and verification procedures remain separate until Token Harness has
enough evidence to implement a reviewed managed integration. GitNexus-specific safety boundaries are
documented in [gitnexus.md](gitnexus.md).

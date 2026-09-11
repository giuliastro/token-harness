# Candidate benchmark workflow

Token Harness evaluates candidate optimizers against the user's **actual current stack**, not against
an artificially bare Claude Code or Codex setup. Candidate benchmarking is evidence collection only:
it does not install, enable, disable or configure Headroom, mcptoon or GitNexus.

The benchmark sidecar records which candidate the experiment targets. That label is not proof that
the candidate was active. The person or automation running the experiment must establish candidate
activation separately and keep the task conditions comparable.

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

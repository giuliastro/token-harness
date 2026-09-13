# Headroom candidate evidence

Headroom remains a **candidate broad-context owner**, not a managed Token Harness provider. This file
records what Token Harness has actually reviewed so future sessions do not turn compatibility smoke
evidence into a promotion claim.

## Reviewed build

As of 2026-09-13, the candidate observer admits exactly **Headroom 0.37.0** for paired experimental
benchmarking. The reviewed Python distribution is `headroom-ai==0.37.0`; agent wrapping requires the
`proxy` extra, so the live smoke installs `headroom-ai[proxy]==0.37.0`.

The passive capability check is intentionally limited to:

```text
headroom --version
headroom wrap --help
```

The smoke must observe both `claude` and `codex` wrap targets. It does **not** run
`headroom wrap claude`, `headroom wrap codex`, `headroom unwrap`, a proxy session, Serena setup, or
any other command that could mutate a developer's harness configuration.

Version admission is fail-closed. `0.36.x` is below the reviewed build, while a future `0.37.1` or
`0.38.0` is also refused until its CLI contract is reviewed. A larger semantic version is not proof
of compatibility.

## What this evidence proves

A green candidate smoke proves only that the exact reviewed package can be installed in the clean CI
environment, reports the expected version, and exposes the Claude/Codex wrapper command surface.
That is enough for the local **benchmark-capability** gate.

It does **not** prove that Headroom:

- saves tokens or subscription allowance on Token Harness workloads;
- preserves task quality;
- was active during an optimized benchmark run;
- composes safely with RTK and HarnessTrim;
- can be installed, configured and rolled back transactionally by Token Harness;
- is eligible for the global provider registry.

Those are independent promotion gates and remain closed until their own evidence exists.

## Benchmark contract

Headroom must be evaluated through the existing paired candidate workflow. The baseline is the
user's current stack; the optimized side adds Headroom only. Project, harness, task intent, model,
reasoning effort, verbosity and unrelated optimizer configuration must remain comparable.

Promotion evidence requires repeated paired runs with quality recorded before efficiency. A single
successful smoke, a single attractive pair, or upstream benchmark numbers cannot produce a
`promising` promotion decision by themselves. The generic candidate thresholds and evidence classes
remain defined in [benchmarking.md](benchmarking.md) and [promotion-readiness.md](promotion-readiness.md).

Because Headroom can own broad context and tool/result behavior, it also has the dedicated
**context-owner admission** gate. Until activation verification, managed lifecycle, compatibility,
reversibility and combined-stack evidence pass independently, Headroom stays candidate-only.

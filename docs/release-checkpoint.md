# Release checkpoint — 2026-10-04

Token Harness `0.1.28` includes the reviewed startup/routing fixes in #365, the optimizer guidance
in #366 and the checkpoint byte-budget correction found during review.

## Changes in this release

- Passive startup update checks preserve approval tickets and stop reserving the mutation lock.
  Concurrent changes invalidate stale background observations.
- Reviewed Codex 0.146.0 routing, reversible standard Windows HarnessTrim hook repair and pinned
  RTK launcher paths preserve native trust, custom commands and agent-specific measurement.
- Public advisory efficiency decisions expose existing evidence and exact-policy receipt references;
  missing budgets remain unknown. Checkpoints retain acceptance criteria and costly facts, with
  objective and next action preserved even at the minimum UTF-8 byte budget.
- Optimizer explanations link source projects and benchmark methodology, preserve workload scope
  and distinguish upstream claims from local measurements. Routing explains delegation and trust.
- RFC 0009 reconciles historical evidence with existing live assignability. No runtime admission or
  savings-evidence guard is widened.

## Release gates

Cross-platform release-candidate CI must pass before creating `release/v0.1.28`. The bridge creates
immutable tag `v0.1.28` and dispatches the exact-tag workflow, which gates publication on tests,
real-runtime smoke, packaging, provenance, npm Trusted Publishing and npm-latest verification.

The Windows repair audit and native pilot remain scoped to their recorded pre-release builds and
conditions. They do not close the published-artifact, sandbox, paired marginal-value or broad
promotion gates. No new subscription or API savings claim is made.

Release notes and verification scope are in [docs/releases/0.1.28.md](releases/0.1.28.md).

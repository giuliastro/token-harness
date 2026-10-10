# Release checkpoint — 2026-10-10

Token Harness `0.1.31` includes the native desktop distribution (#380), deterministic
checks and managed factorial benchmarks (#378), retained guided configuration history
(#381), manual paired captures (#382), and guarded prepared-benchmark recovery (#383).
The three guided follow-ups are merged into main. Version preparation uses its own
reviewable PR, then the release bridge creates the immutable tag and dispatches the
existing exact-tag publication workflow after candidate CI passes.

The latest feature candidate passed all native CI and desktop package targets. Local
validation passed 2,525 tests with nine expected skips. The release candidate repeats
version/packaging, native CI and publication gates; artifact installation and npm/latest
checks follow publication. See [0.1.31 release notes](releases/0.1.31.md) for the scope.
Published Windows execution, repeated quality-gated savings, broader desktop lifecycle
and promotion remain separate gates.

## Previous checkpoint — 2026-10-04

Token Harness `0.1.30` includes the reviewed app-evidence and paired-comparison repair from #371,
merged as `560492ae45b865d3b62dbc91e29909bc8e59da02`. It retains the 0.1.29 native model ladder and
the earlier published 0.1.28 Linux callback/lifecycle evidence, with their original scope.

## Changes in this release

- Coding-app rows show independently aggregated, explicitly attributed output instead of reusing
  overall optimizer totals. Shared history remains unattributed.
- Observed routing callbacks and current quota balances have separate provenance and never imply
  demonstrated savings.
- Benchmark rows preserve both five-hour and weekly comparisons, negative deltas and actual quality
  gates. Unknown or failed gates cannot support positive allowance claims through another pair.
- Read-only comparison guidance explains the existing baseline/optimized capture workflow and the
  distinction between output-history periods, current-project comparisons and live observations.

## Release gates

PR #371 and merged-main CI passed on Windows, macOS and Linux. Local review validation passed 2,418
tests with nine expected skips, typecheck, lint, formatting, build and bundle smoke. Release preparation
passed five version/packaging tests, formatting, lint, build, bundle smoke, staging, temporary package
installation and exact tag validation. Release-candidate cross-platform CI must pass before creating
`release/v0.1.30`. The bridge creates immutable tag `v0.1.30` and dispatches the exact-tag workflow,
which gates publication on tests, real-runtime smoke, packaging, provenance, npm Trusted Publishing
and npm-latest verification.

Earlier native observations do not establish this release's live behavior or actual child-model
selection. Windows published-artifact verification, paired marginal-value evidence and broad
promotion remain separate gates. No new subscription, token or API savings claim is made.

Release notes and verification scope are in [docs/releases/0.1.30.md](releases/0.1.30.md).

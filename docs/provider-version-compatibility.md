# Provider version compatibility

Token Harness should not require users to stay on stale optimizer releases just because the first
integration fixture was captured on an older version. Provider compatibility therefore has separate
layers for provider detection, provider package replacement and managed harness mutation.

## Current upstream releases

As reviewed on 2026-09-12:

- **RTK 0.49.0** is the current reviewed RTK release. Its source still exposes the
  `rtk gain --all --format json` analytics contract consumed by Token Harness. The existing live
  Windows fixture remains 0.48.0, so 0.49.0 is a source-contract review until a real-machine run is
  captured.
- **HarnessTrim 0.3.0** is the current release. It continues to expose the machine-readable
  `harnesstrim capabilities` contract. The additional `digests` field is additive and does not
  invalidate Token Harness's semantic surface/write-set checks.

## Detection policy

The old fixture-backed ranges stay useful as historical evidence, but they are not a reason to
reject a compatible newer release.

For **HarnessTrim**, a release newer than the historical fixture ceiling is accepted when all of the
following are true:

1. the executable reports a version;
2. `harnesstrim capabilities` reports that same version;
3. the capability document is still readable;
4. the semantic surface/write-set comparison reports no drift.

This means a compatible future HarnessTrim release does not need a hard-coded version bump merely
to be detected and verified. Managed mutation remains a separate decision: delegated writes are
still allowed only when the installed build's declared write set remains inside the reviewed
containment boundary and covers the reviewed artifacts.

For **RTK**, there is currently no equivalent machine-readable capability contract. Token Harness
therefore promotes explicitly source-reviewed releases beyond the historical live fixture ceiling.
RTK 0.49.0 is reviewed. A later RTK release remains detectable and usable for observation, but is
reported as `unknown-newer` until the specific contract Token Harness consumes has been checked.

## Package updates are a separate gate

`token-harness update` replaces an already-installed provider package; it does not silently install
an absent provider. Replacing that package does **not** by itself edit Claude Code, Codex or OpenCode
configuration, so it no longer requires an exact provider × harness × provider-version ×
harness-version × OS compatibility row merely to replace the binary/package.

Instead, package replacement has its own reviewed provider-target policy:

- RTK package targets through **0.49.0** are admitted;
- HarnessTrim package targets through **0.3.0** are admitted;
- a target newer than the reviewed provider-package ceiling is reported as available but remains
  blocked for unattended update until that provider contract is reviewed.

HarnessTrim updates use its declared `pnpm` channel. Token Harness now has an executable global
exact-version recipe (`pnpm add --global harnesstrim@<version>`) and a machine-readable global
inventory query. The inventory captures the previous version so transaction rollback can reinstall
and re-read that exact version if a later transaction step fails. The pnpm mutation/inventory argv is
currently documentation-reviewed rather than live-machine-observed, so the executor keeps emitting
its existing unverified-channel diagnostic until a real run is captured.

RTK continues to use the provider's selected installation channel. On Windows the current manifest
prefers WinGet. As of 2026-09-12 the public WinGet package repository contains RTK through 0.48.0,
while upstream RTK is 0.49.0, so WinGet cannot yet deliver 0.49.0. Supporting the upstream Windows
release ZIP as a managed fallback is a distinct installation-channel task; Token Harness must not
pretend a stale channel supplied a release it does not contain.

The exact compatibility matrix is still required when Token Harness wants to **mutate an agent
integration**. This preserves the strict RFC 0009 safety boundary without turning historical fixture
versions into permanent package pins.

A future HarnessTrim build can be accepted after it is installed when its capability contract still
matches, but that does not automatically make an unknown future package target safe for unattended
pre-install update. Bridging that last gap requires an install-time contract postcondition with an
atomic rollback path, not a blanket semver allowance.

## What this policy does not claim

A provider being version-compatible is not evidence that an RTK + HarnessTrim combination has been
benchmarked together, nor that a passive receipt belongs to a particular harness. Combined-stack
review and harness-scoped runtime evidence remain separate gates.

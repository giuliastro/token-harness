# Provider version compatibility

Token Harness should not require users to stay on stale optimizer releases just because the first
integration fixture was captured on an older version. Provider compatibility therefore has two
separate layers.

## Current upstream releases

As reviewed on 2026-09-12:

- **RTK 0.49.0** is the current reviewed RTK release. Its source still exposes the
  `rtk gain --all --format json` analytics contract consumed by Token Harness. The existing live
  Windows fixture remains 0.48.0, so 0.49.0 is a source-contract review until a real-machine run is
  captured.
- **HarnessTrim 0.3.0** is the current release. It continues to expose the machine-readable
  `harnesstrim capabilities` contract. The additional `digests` field is additive and does not
  invalidate Token Harness's semantic surface/write-set checks.

## Policy

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

## What this policy does not claim

A provider being version-compatible is not evidence that an RTK + HarnessTrim combination has been
benchmarked together, nor that a passive receipt belongs to a particular harness. Combined-stack
review and harness-scoped runtime evidence remain separate gates.

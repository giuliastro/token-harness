# Provider version compatibility

Token Harness should not require users to stay on stale optimizer releases just because the first
integration fixture was captured on an older version. Provider compatibility therefore has separate
layers for provider detection, provider package replacement and managed harness mutation.

## Current upstream releases

As reviewed on 2026-10-03:

- **RTK 0.51.0** is the current source-reviewed RTK release. RTK 0.50.0 introduced the native
  Codex command rewrite hook, and the v0.51.0 source retains the same `rtk hook codex` contract.
  Earlier releases such as 0.49.0 provide only prompt guidance for Codex. The latest live
  harness-mutation fixture on Windows remains 0.48.0. The direct GitHub release path keeps its
  digest, version and rollback checks; its previous native Windows exercise used an earlier RTK
  release. Reviewing 0.51.0 does not widen any RFC 0009 harness-mutation row.
- **HarnessTrim 0.3.1** is the current reviewed release. It continues to expose the machine-readable
  `harnesstrim capabilities` contract. The additional `digests` field is additive and does not
  invalidate Token Harness's semantic surface/write-set checks. A real Windows update to 0.3.0 via
  npm has been validated.
- **mcptoon 0.7.10** is the source-reviewed installation/campaign target. It is registered as an
  optional managed provider, not a promoted production-baseline mechanism. Historical Linux
  recordings cover Codex 0.152.1/0.153.0 and Claude Code 2.1.269 with mcptoon 0.7.10. Version
  0.1.26 supports installation through an already-present pipx or uv; these package paths do not
  imply new live compatibility recordings or successful selection evidence.

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
RTK 0.51.0 is source-reviewed for the Codex hook contract. The adapter recognizes Codex hooks on
RTK 0.50.0 and later; the historical Windows mutation fixture and the Linux RTK/HarnessTrim chain
fixture remain separately scoped evidence.

For **mcptoon**, ordinary managed setup checks the installed version floor and required passive
compact/JSON CLI surfaces, while historical recordings and selection-campaign admission remain
separately scoped. Capability acceptance is not a new benchmark tuple or promotion decision.

The published implementation uses historical compatibility rows plus live assignable capability,
ownership, containment, drift and post-apply checks for ordinary managed setup. Some surfaces,
including RFC 0030 native prompt-hook formats and exact combined-stack/selection evidence, retain
stricter independent gates. RFC 0009's October 4 amendment explicitly documents these distinct
admission paths and their negative cases following the review tracked by
[#362](https://github.com/giuliastro/token-harness/issues/362).
No evidence recording or promotion is widened by this documentation.

## Package updates are a separate gate

`token-harness update` replaces an already-installed provider package; it does not silently install
an absent provider. Replacing that package does **not** by itself edit Claude Code, Codex or OpenCode
configuration, so it no longer requires an exact provider × harness × provider-version ×
harness-version × OS compatibility row merely to replace the binary/package.

Instead, package replacement has its own reviewed provider-target policy:

- RTK package targets from **0.44.0 onward** are admitted, with runtime post-install verification;
- HarnessTrim package targets from **0.0.5 onward** are admitted, with capability-contract
  post-install verification;
- other registered provider package targets use their supported floors and runtime capability
  postconditions; a current source-reviewed target is historical evidence, not a universal future
  ceiling;
- an update remains reviewed/approved and must verify the exact active installation, restoring prior
  state when the required postcondition fails.

HarnessTrim package updates use **npm**, matching the upstream install contract. The updater queries
`npm view harnesstrim version`, applies an exact global version with
`npm install --global harnesstrim@<version>`, and can capture the prior global version for rollback.
This also avoids making a working Windows update depend on a configured `PNPM_HOME`; the earlier
pnpm-only channel failed on a real Windows machine even though HarnessTrim itself was healthy.

RTK's ordinary Windows channel remains WinGet. WinGet publishes RTK version strings with the common
release-tag `v` prefix (for example `v0.48.0`), which Token Harness accepts as the same semantic
version as `0.48.0` while preserving the raw channel spelling for an exact WinGet install request.
The v-prefixed WinGet query/update path has been validated on a real Windows machine.

The historical Windows exercise observed WinGet at **v0.48.0**. The updater queries current channel
state rather than assuming that catalog observation remains current. On native Windows, when WinGet
lags the current source-reviewed RTK **0.51.0** target, Token Harness can use the exact official GitHub release asset
`rtk-x86_64-pc-windows-msvc.zip` instead of pretending the stale package catalog is current.

That direct-release path is intentionally narrower than a generic downloader:

- it queries the exact stable reviewed tag from `api.github.com/repos/rtk-ai/rtk`;
- it accepts only the exact Windows x64 ZIP from the official `rtk-ai/rtk` release path;
- it requires GitHub's published SHA-256 and verifies the complete ZIP before extraction;
- metadata, redirects, archive size, archive entry count and extracted executable size are bounded;
- only the root `rtk.exe` is extracted, so archive paths are never materialized on disk;
- it replaces the currently resolved `rtk.exe`, never an arbitrary directory merely because it is
  on `PATH`;
- previous executable bytes are retained under the Token Harness state directory;
- the replacement is staged beside the target, then `rtk --version` must report the reviewed target;
- a failed postcondition restores and re-verifies the exact previous bytes/version;
- if Windows Smart App Control or another application-control policy blocks a freshly released
  unsigned binary, the updater reports that possibility after restoring the previous executable;
- if another ordinary provider update fails later in the same `update` command, Token Harness also
  attempts to restore RTK before returning.

This direct path grants no harness-write permission by itself. Package updates and agent integration
writes remain separate plans/checks, with the integration's own capability/schema, ownership,
containment, transaction and verification requirements. Package postconditions and retained prior
inventory/bytes support rollback when an installed target fails the required runtime contract.

## What this policy does not claim

A provider being version-compatible is not evidence that an RTK + HarnessTrim combination has been
benchmarked together, nor that a passive receipt belongs to a particular harness. Likewise, historical
mcptoon compatibility rows and optional registry membership are not production-stack promotion.
Combined-stack review, harness-scoped runtime evidence and the candidate promotion-readiness gates
remain separate decisions.

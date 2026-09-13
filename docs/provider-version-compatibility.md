# Provider version compatibility

Token Harness should not require users to stay on stale optimizer releases just because the first
integration fixture was captured on an older version. Provider compatibility therefore has separate
layers for provider detection, provider package replacement and managed harness mutation.

## Current upstream releases

As reviewed on 2026-09-13:

- **RTK 0.49.0** is the current reviewed RTK release. Its source still exposes the
  `rtk gain --all --format json` analytics contract consumed by Token Harness. The latest live
  harness-mutation fixture on Windows remains 0.48.0, but the package-only direct GitHub release
  fallback to 0.49.0 is exercised on native Windows with digest verification, version verification
  and rollback. That package path does not widen any RFC 0009 harness-mutation row.
- **HarnessTrim 0.3.0** is the current reviewed release. It continues to expose the machine-readable
  `harnesstrim capabilities` contract. The additional `digests` field is additive and does not
  invalidate Token Harness's semantic surface/write-set checks. A real Windows update to 0.3.0 via
  npm has been validated.
- **mcptoon 0.7.10** is the reviewed managed-candidate lifecycle release. Token Harness now has two
  exact RFC 0009 admission rows on Linux non-WSL, backed by live Ubuntu recordings: Codex 0.152.1 and
  Claude Code 2.1.269, both with mcptoon 0.7.10. mcptoon remains a candidate rather than a globally
  registered provider; this
  exact compatibility evidence does not satisfy the other promotion-readiness gates by itself.

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

For **mcptoon**, candidate detection and managed lifecycle are intentionally narrower than provider
promotion. The reviewed lifecycle recognizes the exact managed surface around 0.7.10, but RFC 0009
admits managed harness mutation only for the two recorded Linux non-WSL combinations: Codex 0.152.1
and Claude Code 2.1.269. Adjacent Claude/Codex versions, adjacent mcptoon versions, WSL, Windows and
macOS remain refused until separately recorded and reviewed. No semver inference widens either row.

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

HarnessTrim package updates use **npm**, matching the upstream install contract. The updater queries
`npm view harnesstrim version`, applies an exact global version with
`npm install --global harnesstrim@<version>`, and can capture the prior global version for rollback.
This also avoids making a working Windows update depend on a configured `PNPM_HOME`; the earlier
pnpm-only channel failed on a real Windows machine even though HarnessTrim itself was healthy.

RTK's ordinary Windows channel remains WinGet. WinGet publishes RTK version strings with the common
release-tag `v` prefix (for example `v0.48.0`), which Token Harness accepts as the same semantic
version as `0.48.0` while preserving the raw channel spelling for an exact WinGet install request.
The v-prefixed WinGet query/update path has been validated on a real Windows machine.

The public WinGet package repository currently contains RTK through **v0.48.0**, while the reviewed
upstream release is **0.49.0**. On native Windows, when WinGet is behind the already-reviewed RTK
package ceiling, Token Harness can use the exact official GitHub release asset
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

This direct path still grants **no harness-write permission**. Exact provider × harness × version ×
platform compatibility rows remain mandatory when Token Harness wants to mutate an agent
integration. The release updater changes a provider binary only; it does not widen RFC 0009.

A future HarnessTrim build can be accepted after it is installed when its capability contract still
matches, but that does not automatically make an unknown future package target safe for unattended
pre-install update. Bridging that last gap requires an install-time contract postcondition with an
atomic rollback path, not a blanket semver allowance.

## What this policy does not claim

A provider being version-compatible is not evidence that an RTK + HarnessTrim combination has been
benchmarked together, nor that a passive receipt belongs to a particular harness. Likewise, two
exact mcptoon compatibility rows are not proof that mcptoon should join the managed provider registry.
Combined-stack review, harness-scoped runtime evidence and the candidate promotion-readiness gates
remain separate decisions.

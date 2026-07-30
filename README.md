# Token Harness

> One control plane for token-efficient coding agents.

Token Harness is an open-source orchestrator for token-saving tools used by coding
agents. It detects the active coding harness, installs compatible optimization
providers, prevents conflicting integrations, verifies that the resulting pipeline
works, and reports savings through one normalized metrics model.

Token Harness is not another compressor. It coordinates specialized projects such
as:

- [RTK](https://github.com/rtk-ai/rtk) for command rewriting and shell-output reduction;
- [HarnessTrim](https://github.com/giuliastro/HarnessTrim) for deterministic reducers,
  harness adapters, skills, pipes, and MCP integration;
- additional providers for repeated-output deduplication, MCP sandboxing, repository
  retrieval, conversation compression, and output discipline.

Upstream tools remain independent. Token Harness installs supported releases through
their official distribution channels and never silently vendors or forks them.

## Product identity

| Surface | Value |
| --- | --- |
| Product name | Token Harness |
| Repository/package slug | `token-harness` |
| CLI command | `token-harness` |
| License | Apache-2.0 |
| Runtime | Node.js 22.13.0+ |
| Language | TypeScript |
| Package manager | pnpm |

## Core principles

1. **Plan before apply.** Every mutation is represented as a reviewable plan. Dry-run
   is the default, and no flag skips planning.
2. **One owner per interception surface.** The planner prevents two providers from
   rewriting or compressing the same payload unless that exact chain is validated — and
   it keeps checking after installation, because config files keep changing.
3. **Upstreams stay upstream.** Providers wrap official installers and APIs instead
   of copying their implementations.
4. **Measured, not marketed.** Exact, estimated, and counterfactual savings are
   reported separately and never summed into one headline number.
5. **Proven, not assumed.** Verification states its tier: presence, config-only, or an
   observed canary. A configuration that looks correct is never presented as proof that
   the harness reaches the provider.
6. **Reversible by construction.** Configuration edits are marker-owned, backed up,
   journaled, and removable.
7. **Local-first.** No account or telemetry is required. Usage data stays local unless
   the user explicitly enables an upstream service.
8. **Cross-platform.** Windows, macOS, Linux, and WSL are first-class targets, with
   unsupported combinations surfaced before installation.

## Initial user experience

```text
token-harness doctor
token-harness plan --harness codex
token-harness apply
token-harness status
token-harness verify
token-harness metrics
token-harness rollback
```

Existing installations are adopted, not replaced. If RTK or HarnessTrim is already
configured by hand, Token Harness detects it, plans around it, and leaves it in place on
uninstall.

The first useful release supports Codex, Claude Code, and OpenCode. RTK is managed
end to end: detected, installed, configured, verified, measured. HarnessTrim is detected,
adopted, reconciled against RTK's ownership, and measured — but not installed, because at
its current release no configuration exists that would let both tools reduce output without
contesting the same surface. Token Harness reports that contest instead of hiding it.

Additional tools, and joint reduction by two providers, are introduced only after
compatibility and attribution tests prove they compose safely.

## Status

Version `0.0.1`. Per the release gates below, `0.0.x` means **internal architecture
and fixtures, with no stability promise** — the number is a description of the
contents, not a modest way of saying "nearly done".

Complete:

| Phase | What landed |
| --- | --- |
| 0 | The seven accepted RFCs in `docs/rfcs/` |
| 1 | Workspace and CI, domain contracts, CLI shell with the RFC 0006 golden transcripts |
| 2.1 | Platform facts, path resolution, executable resolution, the state-permission property |
| 2.2 | The safe process runner, and a fake runner with expectation matching |
| 2.3 | File ownership, snapshots including recorded absence, marker-block and JSON-merge actions, the transaction journal and verified rollback |
| 2.5 | In progress — the live-verification spike, logged in `docs/spikes/` |

The platform and process layers live in a fourth workspace package,
`packages/platform`, extracted per RFC 0001 §Repository shape once the executor and
the adapters needed it.

What the command surface does today:

```text
token-harness --help
token-harness --version
token-harness doctor [--json]
token-harness plan   [--json]
token-harness status [--json]
```

The exit-code table, the `--json` envelope, and the stream discipline from RFC 0006
are implemented in full. `apply`, `verify`, `metrics`, `update`, `rollback`, and
`uninstall` are rejected as *unavailable* rather than as unknown, so a script can
tell "not built yet" from "you typed it wrong".

## Installing 0.0.1

The package is a single self-contained ESM artifact with **no dependencies at all**.
It is not on npm yet — publishing is PLAN §8.3, together with provenance, SBOM, and
signing — but it installs from a tarball you build yourself, and CI proves that on
Windows, macOS, and Linux on every commit:

```bash
pnpm install && pnpm build && pnpm package
npm install -g ./dist/package
token-harness doctor
```

`pnpm package` stages `dist/package/`: the bundle, a generated manifest, the README,
and the licence. `pnpm smoke:install` packs it, installs the tarball into a scratch
directory with no workspace above it, and runs the result — which is what catches a
manifest that names the wrong `bin` or carries a dependency npm cannot resolve.

To run it without installing:

```bash
node dist/bundle/token-harness.mjs doctor
```

### What it will and will not tell you

It reports the truth about your machine. `doctor` detects the operating system,
distinguishes native Windows from WSL, resolves the state directory per RFC 0001, and
refuses to run rather than fall back to a world-writable location if it cannot.

It finds **no harnesses and no providers**, because no adapter exists yet — those are
Phases 3 to 6. So `doctor` prints a truthful report of an environment it cannot yet
inspect, and that is the whole of it. What is worth reviewing at `0.0.1` is the
contract, not the product: the exit codes, the envelope, the stream discipline, the
ownership and rollback guarantees, and the platform behaviour on Windows.

The first release that does something useful for a user is `0.1.0`, and the gate for
that number is listed below.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke
pnpm package
pnpm smoke:install
```

`pnpm build` produces the self-contained artifact at `dist/bundle/token-harness.mjs`;
`pnpm smoke` runs it from a temporary directory outside the repository, so anything
that failed to inline shows up as a resolution failure rather than as a passing test.
CI runs all of it on `windows-latest`, `macos-latest`, and `ubuntu-latest`, in that
order and without fail-fast, because the failures this project exists to prevent are
mostly Windows-specific and finding them after two green jobs is how they become
workarounds instead of design.

## Release gates

| Version | Gate |
| --- | --- |
| `0.0.x` | Internal architecture and fixtures. No stability promise. **← here** |
| `0.1.0` | RTK and HarnessTrim, three harnesses, transactional install, verification with declared tiers, metrics, brownfield adoption |
| `0.2.0` | A third provider, goal-based profiles, the A/B benchmark matrix |
| `1.0.0` | Stable provider and harness contracts, two release cycles with no configuration-loss defects, published benchmark results |

`PLAN.md` §16 is the authority; this table is a summary of it.

`pnpm golden` regenerates the derived halves of the golden fixtures. It never
touches the five human transcripts transcribed from RFC 0006 — see
[tests/fixtures/README.md](tests/fixtures/README.md).

CI runs Windows, macOS, and Linux, with Windows first in the matrix and the
matrix set not to fail fast.

- [Development plan](PLAN.md)
- [Foundation decisions](docs/rfcs/0001-foundation.md)
- [Provider contract](docs/rfcs/0002-provider-contract.md)
- [Capability and conflict model](docs/rfcs/0003-capabilities-and-conflicts.md)
- [Safety and installation model](docs/rfcs/0004-safety-and-installation.md)
- [Metrics and attribution](docs/rfcs/0005-metrics-and-attribution.md)
- [CLI contract](docs/rfcs/0006-cli-contract.md)


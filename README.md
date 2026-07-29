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

Phase 0 is complete. Phase 1 — the workspace, the domain contracts, and the CLI
shell — is implemented.

What works today:

```text
token-harness --help
token-harness --version
token-harness doctor [--json]
token-harness plan   [--json]
token-harness status [--json]
```

The exit-code table, the `--json` envelope, and the stream discipline from
RFC 0006 are implemented in full. The harness and provider registries are empty:
detection, planning, and mutation land in Phases 2 through 6, and until then
`doctor` truthfully reports an environment it cannot yet inspect. `apply`,
`verify`, `metrics`, `update`, `rollback`, and `uninstall` are rejected as
unavailable rather than as unknown.

### Not installable yet, and not yet useful

Two separate limitations, both deliberate.

**Not on npm.** There is no `npm install -g token-harness` and no
`npx token-harness`. The package is marked private, because publishing it today
would produce a tarball nobody could install: it depends on two private
workspace packages through the `workspace:` protocol, which npm rejects.
Distribution — publishing, provenance, SBOM, signing, `npx` — is Phase 8.3, and
PLAN §17.2 keeps packaging beyond npm an open decision. `apps/cli/test/packaging.test.ts`
fails the moment `private` is removed while the workspace dependencies remain,
so that question cannot be skipped when the time comes.

**Nothing to detect.** Even built and run locally, `doctor` finds no harnesses
and no providers, because no adapter exists yet. What the shell does today is
the contract, not the product: exit codes, the envelope, stream discipline, and
the rendering pinned by the RFC 0006 golden transcripts. The first release that
does something for a user is `0.1.0`, after Phases 2 through 7.

To run it from a clone:

```bash
pnpm install && pnpm build
node dist/bundle/token-harness.mjs doctor
```

`dist/bundle/token-harness.mjs` is a self-contained ESM artifact and needs no
`node_modules` beside it.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

`pnpm build` produces a self-contained ESM artifact at
`dist/bundle/token-harness.mjs`; `pnpm smoke` runs it from a temporary directory
outside the repository, so a missing inline shows up as a resolution failure.

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


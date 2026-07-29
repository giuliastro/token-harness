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

Phase 0 is complete at the design level. This repository currently contains the
contracts and implementation roadmap from which the greenfield implementation will
start.

- [Development plan](PLAN.md)
- [Foundation decisions](docs/rfcs/0001-foundation.md)
- [Provider contract](docs/rfcs/0002-provider-contract.md)
- [Capability and conflict model](docs/rfcs/0003-capabilities-and-conflicts.md)
- [Safety and installation model](docs/rfcs/0004-safety-and-installation.md)
- [Metrics and attribution](docs/rfcs/0005-metrics-and-attribution.md)
- [CLI contract](docs/rfcs/0006-cli-contract.md)


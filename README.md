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
| Runtime | Node.js 22+ |
| Language | TypeScript |
| Package manager | pnpm |

## Core principles

1. **Plan before apply.** Every mutation is represented as a reviewable plan. Dry-run
   is the default.
2. **One owner per interception surface.** The planner prevents two providers from
   rewriting or compressing the same payload unless that exact chain is validated.
3. **Upstreams stay upstream.** Providers wrap official installers and APIs instead
   of copying their implementations.
4. **Measured, not marketed.** Exact, estimated, and counterfactual savings are
   reported separately.
5. **Reversible by construction.** Configuration edits are marker-owned, backed up,
   journaled, and removable.
6. **Local-first.** No account or telemetry is required. Usage data stays local unless
   the user explicitly enables an upstream service.
7. **Cross-platform.** Windows, macOS, Linux, and WSL are first-class targets, with
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

The first useful release will support Codex, Claude Code, and OpenCode with RTK and
HarnessTrim. Additional tools are introduced only after compatibility and attribution
tests prove that they compose safely.

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


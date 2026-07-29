# RFC 0001: Product foundation

- Status: Accepted
- Date: 2026-07-29

## Summary

Token Harness is a new project, separate from HarnessTrim. It is a local-first control
plane for installing, configuring, verifying, and measuring token-saving tools across
coding harnesses.

## Product boundary

Token Harness owns:

- harness and provider detection;
- compatibility planning and conflict resolution;
- reviewable installation plans;
- safe configuration merging;
- transactional apply and rollback;
- verification and health checks;
- normalized metrics ingestion and reporting;
- provider and harness registries;
- profiles that choose a compatible set of capabilities.

Token Harness does not own:

- RTK's command parsers or filters;
- HarnessTrim's reducers and harness plugins;
- a universal compression algorithm;
- model-provider billing;
- hosted telemetry or mandatory accounts;
- forks of healthy upstream projects;
- opaque installation scripts downloaded and executed without review.

## Relationship with HarnessTrim

HarnessTrim remains an independent project and package. It becomes a first-party
Token Harness provider.

HarnessTrim continues to own deterministic reduction and its native adapters. To
integrate cleanly, it will later expose:

- machine-readable `doctor`, `metrics`, and capability output;
- explicit enable/disable controls per optimization surface;
- a versioned metrics schema;
- stable dry-run and uninstall contracts.

Changes to HarnessTrim are developed and released in its own repository.

## Initial provider strategy

### MVP

1. RTK
2. HarnessTrim

### Validated expansion candidates

1. Dejavu for repeated command-output deltas;
2. Headroom or Context Mode for broad context/MCP optimization;
3. Repowise for repository intelligence;
4. Caveman for opt-in output terseness;
5. Lazy MCP for MCP schema discovery.

Expansion candidates are not enabled merely because they are installed. Each must
have:

- a maintained upstream;
- an identified license;
- supported installation channels;
- a capability declaration;
- a harness/OS compatibility matrix;
- conflict tests;
- a metrics importer or an explicit "unmeasured" status;
- uninstall verification.

## Technical foundation

### Runtime

- Node.js 22 or newer;
- TypeScript in strict mode;
- pnpm workspace;
- ESM modules;
- built-in `node:test` unless a test need justifies another runner;
- a bundled CLI artifact for npm distribution.

The CLI is not in the hot path of every tool result. Performance-sensitive filtering
remains inside providers such as RTK. TypeScript therefore optimizes contributor speed
and cross-platform integration without compromising the runtime path that matters.

### Repository shape

The implementation is planned as:

```text
apps/
  cli/                  public token-harness command
packages/
  core/                 domain model, planner, capability resolver
  provider-sdk/         provider manifest and adapter contract
  harness-sdk/          harness detection and config primitives
  state/                journal, backups, rollback, local database
  metrics/              normalized events, importers, reports
  providers/
    rtk/
    harnesstrim/
  harnesses/
    codex/
    claude/
    opencode/
docs/
  rfcs/
tests/
  fixtures/
  integration/
```

Packages may be consolidated during the first implementation spike if the separation
creates ceremony without a real boundary.

## Configuration and state

Project policy is declared in `token-harness.yaml`.

Machine-local state is kept outside the repository:

- Windows: `%LOCALAPPDATA%\TokenHarness`
- macOS: `~/Library/Application Support/TokenHarness`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/token-harness`

The state root contains:

- installed-provider inventory;
- transaction journals;
- configuration backups;
- verification receipts;
- normalized metrics;
- no credentials or raw source code.

## CLI contract

The first stable command surface is:

```text
token-harness doctor
token-harness plan
token-harness apply
token-harness status
token-harness verify
token-harness metrics
token-harness update
token-harness rollback
token-harness uninstall
```

All non-interactive commands eventually support `--json`. Human output and
machine-readable output are renderings of the same result objects.

## Licensing

Token Harness uses Apache License 2.0.

Provider integrations invoke independently distributed upstream software. Provider
metadata records the upstream license and installation source. Source-available or
copyleft providers may be managed as external installations, but they are never
bundled into Token Harness without a specific licensing review.

## Decisions

- Separate repository: accepted.
- Public name `Token Harness`: accepted.
- Repository/package/CLI slug `token-harness`: accepted.
- Apache-2.0: accepted.
- TypeScript/Node/pnpm: accepted.
- External provider model instead of vendoring: accepted.
- Local-first and telemetry-off-by-default: accepted.


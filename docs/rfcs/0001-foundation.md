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

HarnessTrim continues to own deterministic reduction and its native adapters. As of
version `0.0.5` it already provides what the integration needs to function:

- `harnesstrim doctor` for project diagnosis;
- `harnesstrim install <harness>`, dry-run by default with an explicit `--apply`;
- `harnesstrim metrics` over JSONL telemetry, off by default;
- adapters for OpenCode, Codex, Claude Code, Hermes, and Pi.

Token Harness therefore does **not** block `0.1.0` on upstream work. The adapter is
written against HarnessTrim as it exists, in a mode RFC 0005 calls legacy ingestion.

The following upstream additions would improve fidelity and are `0.1.x` refinements,
not release gates:

- `--json` on `doctor` and `metrics`, removing prose parsing from the detection path;
- a `capabilities` command, replacing a statically declared narrow capability set;
- an `uninstall` command, so integration removal is not restore-only;
- `schemaVersion`, a native event ID, and token counts on `TrimEvent`.

Changes to HarnessTrim are developed and released in its own repository. HarnessTrim
never depends on Token Harness.

HarnessTrim supports more harnesses than Token Harness manages at `0.1.0`. A provider
supporting an unmanaged harness is a normal condition, not a misconfiguration, and must
never be reported as a problem.

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

- Node.js 22.13.0 or newer;
- TypeScript in strict mode;
- pnpm workspace;
- ESM modules;
- built-in `node:test` unless a test need justifies another runner;
- a bundled CLI artifact for npm distribution.

The CLI is not in the hot path of every tool result. Performance-sensitive filtering
remains inside providers such as RTK. TypeScript therefore optimizes contributor speed
and cross-platform integration without compromising the runtime path that matters.

### Repository shape

The implementation starts with three packages:

```text
apps/
  cli/                  public token-harness command, rendering, exit codes
packages/
  core/                 domain model, planner, capability resolver, state, metrics
  adapters/             harness adapters and provider adapters
docs/
  rfcs/
tests/
  fixtures/
  integration/
```

Inside `core` and `adapters`, module boundaries follow the logical separation that an
earlier draft expressed as separate packages: domain, planner, state, metrics,
harnesses, providers. Those boundaries are enforced by import rules and directory
layout, not by workspace packages.

Rationale: a package boundary costs build configuration, version coordination, and
cross-package refactor friction on every change. It buys an independently publishable
unit. Before `0.1.0` there is no external consumer of a `provider-sdk` or
`harness-sdk`, so the cost is real and the benefit is hypothetical.

Extraction, not pre-splitting, is the rule. A package is extracted when a concrete
consumer appears:

- `provider-sdk` and `harness-sdk` when a third party writes an adapter, which is a
  `1.0` concern;
- `metrics` if a separate importer process is ever needed.

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

The state root grants access to no principal beyond its owner, the local system, and
local administrators. On POSIX this is mode `0700`, asserted after creation. On Windows
`fs.chmod` cannot express it and the directory's location does not prove it, so the
effective ACL is read back and its ACEs are asserted. RFC 0004 §State directory
permissions defines the mechanism and the threat-model boundary.

### Storage

`0.1.0` stores normalized events and receipts as append-only JSONL files behind the
storage interface defined in RFC 0005. No SQLite driver is selected.

The primary reason is that no driver is needed yet. A single developer's local event
volume is small, ingestion is append-only, reporting is a bounded scan, and there are no
updates except cursors. Choosing a backend now would be a decision with no forcing
function behind it.

Two secondary considerations support deferring rather than picking `node:sqlite` today:

- On the minimum supported runtime it is Stability 1.1, "Active development". It reaches
  Release Candidate only in Node 25.7.0. The storage layer of a tool whose entire value
  proposition is not losing user data is a poor place to sit on an API with that
  contract.
- Importing it emits `ExperimentalWarning` on stderr. RFC 0006 mandates strict stream
  discipline, and silencing it means either `--no-warnings` process-wide or mutating the
  process warning listeners — both worse than not needing it.

An earlier draft of this section claimed `node:sqlite` requires `--experimental-sqlite`
on Node 22. That was wrong: the flag requirement was removed in Node 22.13.0 and 23.4.0.
The claim is corrected here because a decision resting on a false premise is not a
decision, even when the conclusion happens to survive.

`better-sqlite3` remains costly for a different and still-valid reason: per-platform
prebuilt native binaries fight a self-contained ESM bundle.

A later amendment, recorded because it narrows the claim above rather than overturning it: the
stderr objection assumed the only ways to silence the warning were `--no-warnings`
process-wide or mutating the process warning listeners. There is a third — read in a
short-lived child process, re-entering the same artifact, with `--no-warnings` scoped to that
child alone — and RFC 0005 §Importers §RTK uses it to read a *provider's* database, whose
records exist only there.

That does not change this decision. Using the driver as Token Harness's own storage backend
means an in-process import in the CLI, where the warning reaches the user's stderr and no child
boundary exists to contain it. The two cases differ in exactly the property the objection was
about, so the objection survives where it was raised and is answered where it was not.

Because RFC 0005 already mandates a storage interface, this decision is reversible. A
driver is chosen, and RFC 0008 written, only when one of the triggers in RFC 0005 is
observed.

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

All non-interactive commands support `--json`. Human output and machine-readable output
are renderings of the same result objects.

Exit codes, the JSON envelope, stream discipline, global flags, and the golden-path
transcripts are specified in RFC 0006. They are public contracts and are frozen before
the CLI shell is implemented.

## Licensing

Token Harness uses Apache License 2.0.

Provider integrations invoke independently distributed upstream software. Provider
metadata records the upstream license and installation source. Source-available or
copyleft providers may be managed as external installations, but they are never
bundled into Token Harness without a specific licensing review.

## Decisions

- Separate repository: accepted.
- Public name `Token Harness`: accepted.
- Repository/package/CLI slug `token-harness`: accepted. The npm name was verified
  unclaimed on 2026-07-29.
- Apache-2.0: accepted.
- TypeScript/Node/pnpm: accepted. The runtime floor is `22.13.0`, not `22.0.0`, because
  that is the release where `node:sqlite` stopped requiring a flag. The floor costs
  nothing on an LTS line and keeps RFC 0008 a free choice later.
- External provider model instead of vendoring: accepted.
- Local-first and telemetry-off-by-default: accepted.
- Three workspace packages, extracted rather than pre-split: accepted.
- JSONL storage for `0.1.0`, SQLite deferred behind the storage interface: accepted.
- No upstream HarnessTrim release is a `0.1.0` gate: accepted.
- Windows is the primary development platform for the platform and state layers:
  accepted.


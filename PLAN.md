# Token Harness — Greenfield development plan

## 1. Objective

Build a cross-platform, local-first control plane that installs and coordinates
token-saving tools for coding agents, prevents incompatible pipelines, verifies real
activation, and reports trustworthy savings.

The implementation starts from the accepted Phase 0 RFCs. Scope changes that alter a
public contract, safety invariant, or attribution rule require an RFC update before
code.

## 2. Definition of the first useful release

Version `0.1.0` is useful when a user can:

1. run `token-harness doctor` and detect Codex, Claude Code, or OpenCode;
2. see whether RTK and HarnessTrim are available, installed, configured, or broken;
3. generate a dry-run plan for a compatible RTK + HarnessTrim setup;
4. apply that plan transactionally;
5. verify the actual harness integration;
6. inspect normalized savings from both providers;
7. uninstall or roll back without damaging unrelated configuration;
8. use the workflow on Windows, macOS, and Linux.

No additional provider is required for `0.1.0`.

## 3. Non-goals for 0.1.0

- hosted dashboard;
- organization policy server;
- automatic background updates;
- provider marketplace with remote arbitrary manifests;
- bundling RTK or HarnessTrim binaries inside Token Harness;
- Context Mode, Headroom, Dejavu, Repowise, Caveman, or Lazy MCP installation;
- a GUI;
- claiming total billed-token savings without an A/B measurement.

## 4. Workstream map

```text
Domain contracts
  -> platform/process abstractions
  -> state + transaction engine
  -> harness adapters
  -> provider adapters
  -> capability resolver
  -> CLI workflows
  -> metrics import + reports
  -> live validation
  -> release
```

## 5. Phase 0 — Product and architecture contracts

Status: complete.

Deliverables:

- [x] public identity: Token Harness / `token-harness`;
- [x] Apache-2.0 license decision;
- [x] TypeScript, Node.js 22+, pnpm decision;
- [x] product boundary and HarnessTrim relationship;
- [x] provider lifecycle contract;
- [x] capability taxonomy and conservative conflict model;
- [x] transactional installation and security invariants;
- [x] normalized metrics and attribution model;
- [x] greenfield implementation plan.

Exit criteria:

- all RFCs marked Accepted;
- no production code required;
- new Git repository initialized on `main`;
- clean working tree after the Phase 0 commit.

## 6. Phase 1 — Repository and domain skeleton

### 1.1 Workspace

Create:

```text
apps/cli
packages/core
packages/provider-sdk
packages/harness-sdk
packages/state
packages/metrics
packages/providers/rtk
packages/providers/harnesstrim
packages/harnesses/codex
packages/harnesses/claude
packages/harnesses/opencode
tests/fixtures
tests/integration
```

Add:

- root `package.json`;
- `pnpm-workspace.yaml`;
- strict shared TypeScript configuration;
- lint/format configuration;
- build script for a self-contained ESM CLI;
- unit, integration, typecheck, and package smoke-test scripts;
- CI for Windows, macOS, and Linux.

Acceptance:

- `pnpm install`, `pnpm test`, `pnpm typecheck`, and `pnpm build` pass;
- bundled CLI prints version and help on all three operating systems;
- package smoke test runs without workspace resolution.

### 1.2 Domain types

Implement and test:

- provider and harness IDs;
- platform facts;
- diagnostics and evidence;
- semantic versions and tested ranges;
- capabilities and scoped ownership;
- detection, plan, action, verification, and metrics types;
- JSON serialization round trips;
- schema-version rejection.

Acceptance:

- domain objects contain no filesystem or process implementation;
- invalid manifests fail with actionable diagnostics;
- golden JSON fixtures protect public schemas.

### 1.3 CLI shell

Implement:

```text
token-harness --help
token-harness --version
token-harness doctor [--json]
token-harness plan [--json]
token-harness status [--json]
```

Initially these commands can return empty registries while the architecture is wired.

Acceptance:

- stdout is stable and machine output contains no human decoration;
- diagnostics use stderr;
- exit codes are documented and tested.

## 7. Phase 2 — Platform, process, and transactional state

### 2.1 Platform abstraction

Implement:

- Windows/macOS/Linux/WSL detection;
- home, config, data, state, and cache path resolution;
- executable resolution;
- package-manager discovery;
- environment redaction;
- path normalization without erasing platform semantics.

Acceptance:

- table-driven platform tests;
- no test reads or writes the developer's actual home;
- WSL and native Windows remain distinct.

### 2.2 Safe process runner

Implement:

- executable plus argument-array invocation;
- bounded stdout/stderr;
- timeouts and termination;
- redacted logging;
- working-directory control;
- fake runner with expectation matching.

Acceptance:

- shell interpolation is impossible in the normal API;
- timeout and redaction tests pass on Windows and POSIX;
- provider unit tests require no installed upstream executable.

### 2.3 Typed action executor

Start with:

- create directory;
- write owned file;
- marker-block patch;
- JSON merge;
- run package-manager install;
- run verified command.

Add:

- plan preconditions;
- state snapshots;
- transaction journal;
- rollback;
- idempotency;
- drift detection.

Acceptance:

- every action has apply and rollback tests;
- a simulated mid-plan failure restores the initial fixture byte-for-byte;
- user edits block destructive uninstall;
- plans serialize and can be reviewed before execution.

### 2.4 SQLite storage spike

Compare the Node built-in SQLite API available in the minimum runtime with a maintained
external driver.

Decision criteria:

- Windows/macOS/Linux install reliability;
- bundled CLI compatibility;
- migration support;
- transaction correctness;
- no unexpected build toolchain.

Record the result as RFC 0006 before the storage implementation is coupled to a
driver.

## 8. Phase 3 — Harness adapters

### 3.1 Shared harness contract

Implement:

- detection;
- config discovery;
- supported hook/interception capabilities;
- config parsing and ownership;
- verification surface;
- user-level versus project-level scope.

### 3.2 Codex

Cover:

- native Windows and POSIX configuration paths;
- project and global `AGENTS.md`;
- hooks/plugin capability detection;
- MCP registration;
- trust-aware verification.

### 3.3 Claude Code

Cover:

- settings scopes;
- hook merge and detection;
- plugin/MCP registration;
- instruction-file ownership;
- version-sensitive hook capability.

### 3.4 OpenCode

Cover:

- global and project configuration;
- local plugin wrappers;
- plugin dependency installation;
- pre-command and post-result interception points.

Acceptance for each harness:

- absent, partial, healthy, broken, and user-modified fixtures;
- no live harness required for unit/integration tests;
- one opt-in live smoke test with a verification receipt;
- config round trip preserves unrelated content.

## 9. Phase 4 — Capability resolver and profiles

Implement:

- scoped capability ownership;
- exclusive, chainable, and observational modes;
- compatibility-rule registry;
- provider version constraints;
- hard conflict diagnostics;
- goal-based profiles;
- pipeline graph output.

Initial profiles:

### `safe`

- prefer deterministic local optimization;
- RTK owns shell rewriting/reduction;
- HarnessTrim owns only non-overlapping surfaces;
- no experimental providers.

### `balanced`

Initially identical to `safe`. It gains additional providers only after their
compatibility suites are accepted.

### `custom`

Explicit provider and capability overrides. Unsafe overlaps require a named
compatibility rule, not a generic force flag.

Acceptance:

- property tests ensure at most one owner for every exclusive scope;
- missing compatibility data fails closed;
- plan output explains every provider selection and rejection;
- changing provider order changes the pipeline ID.

## 10. Phase 5 — RTK provider

Implement:

- binary/package detection;
- version and supported-agent detection;
- official installation channel selection per OS;
- installation plan;
- harness-specific `rtk init` configuration plan;
- health verification;
- uninstall plan;
- analytics JSON importer.

Important constraints:

- do not duplicate RTK's rewrite registry;
- do not parse human `rtk gain` output when JSON is available;
- do not install through a network-to-shell pipe;
- tolerate an existing user-managed RTK installation;
- preserve provider-native configuration not owned by Token Harness.

Acceptance:

- fixtures for absent, installed, configured, old, unknown-new, and broken states;
- metrics import is idempotent;
- native Windows covered;
- live smoke test proves a harness command is rewritten;
- rollback restores preexisting hook configuration.

## 11. Phase 6 — HarnessTrim provider and upstream adaptations

### 6.1 HarnessTrim changes in its repository

Add, release, and validate:

- `harnesstrim doctor --json`;
- `harnesstrim metrics --json`;
- `harnesstrim capabilities --json`;
- `harnesstrim install ... --json` dry-run output;
- explicit surface configuration;
- versioned `OptimizationEvent`-compatible output or lossless source fields;
- stable uninstall support.

Do not make HarnessTrim depend on Token Harness.

### 6.2 Token Harness adapter

Implement:

- npm/global/check-out detection;
- version compatibility;
- install/configure/uninstall plans;
- capability narrowing based on RTK ownership;
- health verification;
- legacy JSONL and new metrics ingestion.

Acceptance:

- RTK and HarnessTrim do not reduce the same shell output;
- HarnessTrim skills/instructions do not duplicate RTK instructions;
- existing standalone HarnessTrim users can adopt Token Harness without reinstalling;
- uninstalling Token Harness does not remove a user-managed HarnessTrim installation.

## 12. Phase 7 — Unified workflows and metrics

Complete:

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

Metrics work:

- SQLite schema and migrations;
- RTK importer;
- HarnessTrim importer;
- deduplication and cursors;
- pipeline-level attribution;
- exact/estimated/counterfactual separation;
- provider, harness, project, and date reports;
- JSON export.

Acceptance:

- repeated imports do not change totals;
- overlapping pipeline stages are counted once;
- character-only legacy events are labeled estimated;
- no raw output, command arguments, source paths, or prompts enter the database;
- reports expose coverage, bypasses, latency, and errors.

## 13. Phase 8 — MVP validation and release

### 8.1 Integration matrix

| OS | Codex | Claude Code | OpenCode |
| --- | --- | --- | --- |
| Windows native | required | required | required |
| macOS | required | required | required |
| Linux | required | required | required |
| WSL | required | required | required |

### 8.2 Benchmark matrix

Run baseline and optimized variants for:

- quiet task;
- noisy single-output task;
- repetitive validation loop;
- mixed coding task.

Quality gates:

- no task-success regression in the seed suite;
- 100% must-keep signal recall in deterministic fixtures;
- no false exact-savings claims;
- rollback restores configuration;
- added median planning overhead is negligible;
- provider hot-path overhead remains attributable to the provider, not the control CLI.

### 8.3 Distribution

- publish `token-harness` on npm;
- generate provenance/SBOM;
- sign or attest release artifacts;
- provide `npx token-harness doctor`;
- document native package-manager options only after npm is stable;
- publish compatibility and known-limitations matrices.

## 14. Phase 9 — Provider expansion

Each provider uses the same admission sequence:

```text
research
  -> license review
  -> manifest
  -> detection
  -> plan/uninstall
  -> conflict model
  -> metrics
  -> fixture suite
  -> live validation
  -> opt-in release
  -> default-profile consideration
```

Proposed order:

1. Dejavu;
2. Headroom;
3. Context Mode;
4. Repowise;
5. Caveman;
6. Lazy MCP.

Headroom and Context Mode remain alternatives until a specific composition study says
otherwise. Caveman remains opt-in until its instruction overhead is included in the
break-even calculation. Dejavu remains non-default until RTK ordering and native
Windows support are resolved.

## 15. Issue/PR slicing

Keep changes reviewable:

- one domain contract or action type per PR;
- one harness adapter per PR series;
- one provider lifecycle stage per PR when large;
- fixtures committed with the behavior they protect;
- no provider installation in ordinary CI;
- live tests manually dispatched and isolated;
- documentation updated in the PR that changes a public contract.

Suggested first ten implementation issues:

1. Bootstrap pnpm/TypeScript workspace and CI.
2. Implement domain schemas and JSON fixtures.
3. Implement CLI help/version and result rendering.
4. Implement platform facts and state-path resolution.
5. Implement safe process runner and fake runner.
6. Implement file ownership, snapshots, and marker-block action.
7. Implement JSON merge action and transaction rollback.
8. Decide SQLite driver in RFC 0006.
9. Implement harness registry and Codex detection.
10. Implement provider registry and RTK detection.

## 16. Release gates

### `0.0.x`

Internal architecture and fixtures. No stability promise.

### `0.1.0`

RTK + HarnessTrim, three harnesses, transactional install, verification, metrics.

### `0.2.0`

First additional provider after compatibility validation.

### `1.0.0`

- stable provider/harness contracts;
- safe upgrade/rollback history;
- at least two release cycles without configuration-loss defects;
- full supported OS/harness matrix;
- documented security model and threat review;
- end-to-end benchmark suite with published raw results.

## 17. Open implementation decisions

These are intentionally deferred to measured spikes:

1. Node built-in SQLite versus external driver.
2. YAML library and comment-preserving edit strategy.
3. Bundler and executable packaging beyond npm.
4. Whether package boundaries remain separate or are consolidated.
5. Exact live-verification mechanism for each harness version.
6. Provider-manifest signing model for a future external registry.

None of these decisions changes the accepted product or safety contracts.


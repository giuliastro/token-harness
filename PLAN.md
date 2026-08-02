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
5. verify the actual harness integration, with the verification tier stated;
6. inspect normalized savings from both providers;
7. uninstall or roll back without damaging unrelated configuration;
8. adopt an existing hand-configured RTK or HarnessTrim installation;
9. use the workflow on Windows, macOS, and Linux.

No additional provider is required for `0.1.0`, and no upstream release in another
repository is a gate.

## 3. Non-goals for 0.1.0

- hosted dashboard;
- organization policy server;
- automatic background updates;
- provider marketplace with remote arbitrary manifests;
- bundling RTK or HarnessTrim binaries inside Token Harness;
- installation of any expansion candidate in `docs/provider-landscape.md`;
- a GUI;
- goal-based profile resolution and the `balanced` profile;
- a SQLite storage backend;
- the full A/B benchmark matrix;
- claiming total billed-token savings without an A/B measurement.

## 4. Workstream map

```text
CLI + domain contracts
  -> platform/process abstractions
  -> state + transaction engine
  -> live-verification spike
  -> harness adapters
  -> provider adapters
  -> static capability resolver
  -> CLI workflows
  -> metrics import + reports
  -> MVP validation
  -> release
```

The live-verification spike sits before the adapters because its outcome shapes the
harness adapter contract. Discovering it late would force a rewrite of every adapter.

## 5. Phase 0 — Product and architecture contracts

Status: complete.

Deliverables:

- [x] public identity: Token Harness / `token-harness`, npm name verified unclaimed;
- [x] Apache-2.0 license decision;
- [x] TypeScript, Node.js 22.13.0+, pnpm decision;
- [x] product boundary and HarnessTrim relationship;
- [x] provider lifecycle contract;
- [x] capability taxonomy and conservative conflict model;
- [x] transactional installation and security invariants;
- [x] normalized metrics and attribution model;
- [x] CLI contract: exit codes, JSON envelope, golden path;
- [x] greenfield implementation plan.

Exit criteria:

- all RFCs marked Accepted;
- no production code required;
- new Git repository initialized on `main`;
- clean working tree after the Phase 0 commit.

### RFC allocation

| RFC | Subject | Status |
| --- | --- | --- |
| 0001 | Product foundation | Accepted |
| 0002 | Provider contract | Accepted |
| 0003 | Capability and conflict model | Accepted |
| 0004 | Safety and installation model | Accepted |
| 0005 | Metrics and attribution | Accepted |
| 0006 | CLI contract | Accepted |
| 0007 | Live verification mechanism | Proposed — written from the Phase 2.5 spike |
| 0008 | Metrics storage driver | Reserved — written only when JSONL is outgrown |

## 6. Phase 1 — Repository and domain skeleton

### 1.1 Workspace

Create three packages:

```text
apps/cli
packages/core
packages/adapters
tests/fixtures
tests/integration
```

Internal module layout inside those packages mirrors the logical boundaries — domain,
planner, state, metrics under `core`; harnesses and providers under `adapters` — enforced
by import rules rather than by workspace packages. RFC 0001 records why the boundaries
are extracted on demand rather than pre-split.

Add:

- root `package.json`;
- `pnpm-workspace.yaml`;
- strict shared TypeScript configuration;
- lint/format configuration;
- an import-boundary rule so `adapters` cannot reach into `core` internals;
- build script for a self-contained ESM CLI;
- unit, integration, typecheck, and package smoke-test scripts;
- CI for Windows, macOS, and Linux.

Acceptance:

- `pnpm install`, `pnpm test`, `pnpm typecheck`, and `pnpm build` pass;
- bundled CLI prints version and help on all three operating systems;
- package smoke test runs without workspace resolution;
- CI runs on Windows first in the job matrix, so a Windows failure is not discovered
  after two green jobs.

### 1.2 Domain types

Implement and test:

- provider and harness IDs;
- platform facts;
- diagnostics and evidence;
- semantic versions and tested ranges, for both providers and harnesses;
- capabilities and scoped ownership;
- detection, plan, action, verification, and metrics types;
- the `CliEnvelope` and `Diagnostic` types from RFC 0006;
- JSON serialization round trips;
- schema-version rejection.

Acceptance:

- domain objects contain no filesystem or process implementation;
- invalid manifests fail with actionable diagnostics;
- golden JSON fixtures protect public schemas.

### 1.3 CLI shell

Implement the contract in RFC 0006 in full, even where the underlying registries are
still empty:

```text
token-harness --help
token-harness --version
token-harness doctor [--json]
token-harness plan [--json]
token-harness status [--json]
```

The envelope, exit-code table, and stream discipline are implemented now rather than
retrofitted, because they are the hardest part of the surface to change later.

Golden files are committed for both renderings:

- the human transcripts from RFC 0006 §Golden path;
- the corresponding JSON envelopes;
- the normalizer described in RFC 0006 §Golden-file determinism.

Acceptance:

- `--json` emits exactly one document on stdout and nothing else;
- human diagnostics go to stderr, machine diagnostics go in the envelope;
- every exit code in the RFC 0006 table has a test that produces it;
- human output is golden-compared, not only JSON;
- `--help` and `--version` exit 0 even with an otherwise invalid command line.

## 7. Phase 2 — Platform, process, and transactional state

Windows is the development platform for this phase, with macOS and Linux in CI. The
failures this layer exists to prevent — `.cmd` shims, missing shebangs, path separators,
`%LOCALAPPDATA%` resolution, permission semantics — are almost all Windows-specific, and
finding them last is how they end up as workarounds instead of design.

### 2.1 Platform abstraction

Implement:

- Windows/macOS/Linux/WSL detection;
- home, config, data, state, and cache path resolution;
- executable resolution, including Windows shims and `PATHEXT`;
- package-manager discovery;
- environment redaction;
- path normalization without erasing platform semantics.

Acceptance:

- table-driven platform tests;
- no test reads or writes the developer's actual home;
- WSL and native Windows remain distinct;
- the state root satisfies the RFC 0004 permission property, tested as a property on
  each platform rather than as a `chmod` call;
- an unresolvable `%LOCALAPPDATA%` fails with the unsupported-environment code instead
  of falling back to a world-writable location.

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
- run verified command;
- delegated provider install, per RFC 0002.

Add:

- plan preconditions;
- state snapshots, including recorded absence for files that do not yet exist;
- transaction journal;
- rollback;
- idempotency;
- drift detection.

Acceptance:

- every action has apply and rollback tests;
- a simulated mid-plan failure restores the initial fixture byte-for-byte;
- a delegated install that writes outside its declared `affectedPaths` fails and names
  the undeclared path;
- rollback of a delegated install restores snapshots and never invents an uninstall
  command;
- user edits block destructive uninstall;
- plans serialize and can be reviewed before execution.

### 2.4 Storage

Implement `JsonlStore` against the `MetricsStore` interface from RFC 0005.

No driver comparison happens in `0.1.0`. RFC 0001 and RFC 0005 record why, and RFC 0008
is written only if one of the documented triggers is observed.

Acceptance:

- append, cursor read/write, and filtered query round trip;
- concurrent append from two processes does not corrupt a record;
- a truncated or partially written final line is skipped, not fatal;
- nothing outside the store knows the backend.

Done. `packages/core/src/state/jsonl-store.ts`, exercised by
`tests/integration/jsonl-store.test.ts` against a real filesystem in a temporary directory.
Two notes the acceptance list did not anticipate:

- The store lives under `state/` rather than beside its interface in `metrics/`. The core
  layer rule ranks `metrics` below `state`, so the interface cannot come to depend on a
  backend.
- "Does not corrupt a record" is satisfiable by a writer that silently *drops* records: a
  read-modify-write emulation of the append kept 27 of 800 records and produced zero
  malformed lines. The test therefore counts records as well as parsing them.

### 2.5 Live-verification spike

This is the load-bearing spike of the project. RFC 0002 §Verification tiers requires
that verification either prove interception or declare that it cannot.

Investigate, per harness and per harness version:

- can Token Harness cause the harness to execute an operation that must traverse the
  interception point?
- can the result be observed without a human in the loop?
- what sentinel is unambiguous, cheap, and free of side effects?
- what does the receipt look like, and where is it written?
- which harness versions make tier 3 impossible?

Deliverables:

- a prototype canary for at least one harness, proving the mechanism exists;
- a per-harness tier table, with `config-only` recorded where tier 3 is unreachable;
- RFC 0007 documenting the mechanism and the harness adapter contract it implies.

Acceptance:

- at least one harness reaches tier 3 end to end;
- every harness has a declared tier, and none is left implicit;
- the harness adapter contract in Phase 3 is written against RFC 0007, not guessed.

If no harness can reach tier 3, that is a finding that changes the product claim, and it
is recorded in RFC 0007 and the README before any adapter is written.

## 8. Phase 3 — Harness adapters

### 3.1 Shared harness contract

Implement:

- detection;
- config discovery;
- supported hook/interception capabilities;
- config parsing and ownership;
- verification surface, at the tier established by RFC 0007;
- tested version ranges and unknown-newer warnings, symmetric with providers;
- harness version recorded in every receipt;
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
- the brownfield adoption fixtures from RFC 0004;
- no live harness required for unit/integration tests;
- one opt-in live smoke test with a verification receipt;
- config round trip preserves unrelated content;
- an unowned entry on an exclusive scope is detected and reported.

## 9. Phase 4 — Static capability resolver

`0.1.0` ships the reduced resolver from RFC 0003 §Scope of the resolver at 0.1.0.

Implement:

- scoped capability ownership;
- exclusive, chainable, and observational modes;
- a static compatibility-rule table, committed as data;
- provider and harness version constraints;
- hard conflict diagnostics;
- the `safe` and `custom` profiles;
- pipeline ID derived from the ordered owner list;
- pipeline graph output;
- post-apply conflict detection per RFC 0003 §Continuous conflict detection.

Deferred to `0.2.0`, when a third provider provides the second data point:

- goal-based profiles and the `goals` YAML block;
- automatic provider substitution from goals;
- repository-size and workflow heuristics;
- the general chain-ordering solver.

The `goals` schema is reserved in `token-harness.yaml` now so adding it later is not a
breaking change.

Acceptance:

- property tests ensure at most one owner for every exclusive scope;
- missing compatibility data fails closed;
- plan output explains every provider selection and rejection;
- changing provider order changes the pipeline ID;
- a hook added by hand after apply is detected by `status` and `verify`;
- `balanced` is absent rather than aliased to `safe`.

## 10. Phase 5 — RTK provider

Implement:

- binary/package detection;
- version and supported-agent detection;
- official installation channel selection per OS;
- installation plan;
- harness-specific `rtk init` configuration plan;
- health verification at the RFC 0007 tier;
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
- the brownfield fixtures, including RTK already configured in the surface Token Harness
  would claim;
- metrics import is idempotent;
- native Windows covered;
- live smoke test proves a harness command is rewritten;
- rollback restores preexisting hook configuration.

## 11. Phase 6 — HarnessTrim provider

HarnessTrim `0.0.7` provides `doctor`, `install <harness>` with dry-run default and
explicit `--apply`, `--no-hook` and `--no-instructions` for Claude, `metrics` over JSONL,
and adapters for five harnesses.
### 6.1 What 0.0.5 can and cannot be assigned

An earlier draft of this phase required "capability narrowing based on RTK ownership" and
accepted only if "RTK and HarnessTrim do not reduce the same shell output". Checked
against the source, that narrowing does not exist on any of the three MVP harnesses:

```text
adapter-claude/src/install.ts:6    HOOK_MATCHER        = "Bash"
adapter-codex/src/index.ts:23      CODEX_HOOK_MATCHER  = "^Bash$"
adapter-opencode/src/plugin.ts:37  tool.execute.after  reduces every tool result
```

Claude and Codex reduce Bash and nothing else; OpenCode reduces everything and never uses
`input.tool` as a filter. So HarnessTrim's reducing surface is always either exactly RTK's
assigned scope or a strict superset of it, and no flag narrows it.

A second draft then proposed target states the installer cannot produce either:

- **Codex**, "skills with the hook omitted": `install codex` without `--hook` does skip the
  hook, but it always writes `REDUCE_INSTRUCTION_SNIPPET` into `AGENTS.md`, telling the
  model to pipe output through `harnesstrim reduce`. Per RFC 0003 §The instruction-level
  path that text is part of `shell.output.reduce`, and no flag omits it.
- **OpenCode**, "`metrics.observe` via `mode: dryrun`": `DEFAULT_OPENCODE_ADAPTER_CONFIG`
  sets `mode: "active"`, all four presets set `mode: "active"`, and the config lives in a
  wrapper file that `install opencode` generates. `resolveConfig` gives `options.mode`
  precedence over `HARNESSTRIM_MODE`, so the env cannot override it either. There is no
  invocation of the installer that yields `dryrun`.

An installer that cannot be asked for the target state cannot be delegated to for it.

### What Token Harness manages at 0.1.1

| Provider | Role |
| --- | --- |
| RTK | Managed: detected, installed, configured, verified, measured |
| HarnessTrim | Detected, adopted, reconciled against RTK's ownership, measured, and installed as Claude skills only |

Under `safe`, Token Harness keeps RTK as the only owner of `shell.output.reduce`. For Claude,
HarnessTrim `0.0.7` is installed only through its reviewed skills-only invocation:

```text
harnesstrim install claude <project> --apply --no-hook --no-instructions
```

The invocation creates no HarnessTrim hook and no reduce-pipe instruction, so it does not contest
RTK's exclusive scope. Its containment boundary and write set are reviewed against `0.0.7`; rollback
restores the pre-install snapshot rather than calling the upstream uninstaller.

### What 0.1.0 actually demonstrates

Stated plainly, so no acceptance criterion implies otherwise: **`0.1.0` does not
demonstrate RTK and HarnessTrim jointly reducing a payload**, and does not install
HarnessTrim under `safe`.

That is the honest scope, and it is not a weak result. The feature `0.1.0` proves is the
one that is hard and that nothing else does: given two tools that genuinely contest the
same interception point, Token Harness detects the contest from provider source rather than
from optimism, picks a single owner, explains the exclusion, verifies the survivor actually
intercepts, and attributes savings without double counting.

The pattern that would let HarnessTrim be managed under `safe` is *delegate-then-narrow*:
invoke the upstream installer, then remove or adjust a specifically declared,
marker-fenced entry it wrote. HarnessTrim's `AGENTS.md` block is marker-fenced
(`harnesstrim:begin` / `harnesstrim:end`), so the operation is well defined and reversible.
It is deliberately not used at `0.1.0`, because it means editing an artifact another tool
owns, and that needs its own compatibility fixture and a named rule rather than being
introduced quietly as an implementation detail. It lands with §6.3 item 1, which makes it
unnecessary for Codex anyway.

### 6.2 Adapter, legacy mode

Implement:

- npm/global/check-out detection, from filesystem and version evidence rather than by
  parsing `doctor` prose;
- version compatibility, with the assignment table above validated per harness;
- install and configure plans, expressed as `DelegatedProviderInstallAction` invoking
  `harnesstrim install <harness> --apply`, with declared `affectedPaths` and a
  `containmentBoundary` covering its reviewed write set;
- restore-only uninstall, since HarnessTrim exposes no uninstall command;
- health verification;
- `TrimEvent` JSONL ingestion with the synthesized dedup identity and byte-offset cursor
  from RFC 0005;
- `legacy` importer mode surfaced in `status`.

Acceptance:

- an ownership assignment HarnessTrim cannot implement on a harness is rejected at
  planning time as a planning error, not attempted;
- a target state the upstream installer cannot be asked to produce is likewise rejected at
  planning time, rather than delegated to and hoped for;
- under `safe`, no plan contains a HarnessTrim install action on any MVP harness;
- on every harness, RTK and HarnessTrim never both hold `shell.output.reduce`, and the
  plan states which one was excluded and why;
- a user-installed HarnessTrim whose `AGENTS.md` snippet contests RTK's scope is reported
  as a conflict, with the marker block and file named, and is never silently edited;
- under `custom`, assigning `shell.output.reduce` to HarnessTrim delegates the installer's
  default invocation and excludes RTK from that scope;
- existing standalone HarnessTrim users can adopt Token Harness without reinstalling;
- uninstalling Token Harness does not remove a user-managed HarnessTrim installation;
- Hermes and Pi integrations are reported as unmanaged context and never modified;
- a delegated install that writes inside the boundary but outside `affectedPaths` fails
  and names the path;
- repeated metrics import over an appended, rotated, and truncated JSONL file produces
  stable totals;
- character-only events are labelled `estimated-local` and never summed with exact
  figures.

### 6.3 Upstream refinements, 0.1.x

Developed and released in the HarnessTrim repository, on its own schedule. None gates
`0.1.0`. When each lands, the importer prefers the richer source and the legacy path
becomes the fallback.

Ordered by what it unblocks:

1. **skills without the hook on Claude, or a matcher/surface selector** — this is the one
   that makes RTK and HarnessTrim composable on Claude at all. `install codex` already has
   the right shape; making `install claude` symmetric is the whole change;
2. `--json` on `doctor` and `metrics`, removing prose parsing from the detection path;
3. a `capabilities` command, replacing the statically declared narrow capability set;
4. an `uninstall` command, so removal is not restore-only;
5. `schemaVersion`, native event ID, and token counts on `TrimEvent`.

HarnessTrim never depends on Token Harness.

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
- no raw output, command arguments, source paths, or prompts enter the store;
- reports expose coverage, bypasses, latency, and errors;
- every command matches its RFC 0006 golden transcript.

## 13. Phase 8 — MVP validation and release

### 8.1 Integration matrix

| OS | Codex | Claude Code | OpenCode |
| --- | --- | --- | --- |
| Windows native | required | required | required |
| macOS | required | required | required |
| Linux | required | required | required |
| WSL | required | required | required |

### 8.2 Quality gates for 0.1.0

Per RFC 0005 §Release gating, `0.1.0` must prove that Token Harness does not lie about
savings and does not damage configuration. It does not have to prove how large the
savings are.

Required, and where each is discharged — `tests/integration/release-gates.test.ts` unless
noted:

- 100% must-keep signal recall in deterministic fixtures — **not held here, and not by
  omission.** Recall is a property of a *reducer*: given output containing signal that must
  survive, does the reducer keep it. Token Harness reduces nothing; it installs, verifies and
  measures the tools that do, and so has no recall to have. The gate belongs to RTK and
  HarnessTrim, whose own suites can hold it, and a fixture written here to claim it would be
  the exact dishonesty the gate list exists to prevent;
- no exact-savings claim without both payloads observed;
- every reported figure labelled with its measurement class — including the negative form: a
  character-only source never becomes a token figure, and a counterfactual never reaches a
  realized total;
- rollback restores fixtures byte-for-byte, including after a delegated install — two claims,
  the second being that the surviving package is *reported* rather than passed over in a
  transaction that says "rolled back";
- brownfield adoption succeeds on all four fixture scenarios — RFC 0004's four, each checked
  against the five required behaviours that apply to it;
- added median planning overhead is negligible — measured, with the ceiling stated as a number
  and the reason for its generosity recorded next to it;
- provider hot-path overhead remains attributable to the provider, not the control CLI —
  structural: Token Harness is not in the hot path, and the assertion is over the hook commands
  a plan actually writes;
- every harness has a declared verification tier — and every provider, per harness.

Deferred to `0.2.0` and `1.0.0`:

- the full A/B benchmark matrix across quiet, noisy, repetitive, MCP-heavy,
  large-repository, and mixed scenarios;
- task-success scoring against a seed suite;
- published raw benchmark results.

### 8.3 Distribution

- publish `token-harness` on npm;
- generate provenance/SBOM;
- sign or attest release artifacts;
- provide `npx token-harness doctor`;
- document native package-manager options only after npm is stable;
- publish compatibility, verification-tier, and known-limitations matrices.

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

The researched intake queue, evidence, licenses, and admission gates live in
`docs/provider-landscape.md`. Proposed order:

1. Dejavu for repeated-output deltas;
2. Lazy MCP for on-demand MCP schemas;
3. Repowise for bounded repository retrieval;
4. LiteLLM as the gateway and telemetry seam for routing;
5. one routing-policy owner, evaluated between RouteLLM and vLLM Semantic Router;
6. one broad context owner, evaluated between Headroom and Context Mode;
7. LLMLingua behind a provider that supplies the missing harness lifecycle;
8. Caveman as an opt-in output policy.

The first additional provider is also what unblocks the deferred resolver work: goal-based
profiles are designed against two provider pairs rather than one.

Headroom and Context Mode remain alternatives until a specific composition study says
otherwise. Caveman remains opt-in until its instruction overhead is included in the
break-even calculation. Dejavu remains non-default until RTK ordering and native
Windows support are resolved.

LiteLLM is a gateway substrate, not by itself evidence of intelligent routing or token
savings. RouteLLM and vLLM Semantic Router remain alternative owners of a model request.
Before either can be admitted, a new RFC must define the model-routing capability and a
cost/quality attribution class: routing a request to a cheaper model is never folded into
RFC 0005's exact or estimated token-saving totals.

## 15. Issue/PR slicing

Keep changes reviewable:

- one domain contract or action type per PR;
- one harness adapter per PR series;
- one provider lifecycle stage per PR when large;
- fixtures committed with the behavior they protect;
- brownfield fixtures committed with the adapter they exercise;
- no provider installation in ordinary CI;
- live tests manually dispatched and isolated;
- documentation updated in the PR that changes a public contract.

Suggested first implementation issues:

1. Bootstrap pnpm/TypeScript workspace and CI, Windows first in the matrix.
2. Implement domain schemas, the RFC 0006 envelope types, and JSON fixtures.
3. Implement CLI help/version, result rendering, exit codes, and golden transcripts.
4. Implement platform facts, state-path resolution, and the permission property test.
5. Implement safe process runner and fake runner.
6. Implement file ownership, snapshots including recorded absence, and marker-block
   action.
7. Implement JSON merge action and transaction rollback.
8. Implement `JsonlStore` against the `MetricsStore` interface. **Done** (#13).
9. Run the live-verification spike and write RFC 0007. **Done** — RFC 0007 is Proposed.
10. Implement harness registry and Codex detection. Claude Code was built first, and why is
    recorded in RFC 0007.
11. Implement `collectMetrics` on the RTK adapter. **Done** — RFC 0005 §Importers §RTK was
    amended, because the source the RFC named cannot produce a per-operation event.
12. Implement the `metrics` command over the store. **Done** — it imports, queries, and
    aggregates, keeping the measurement classes apart structurally. Two findings recorded
    beside the code: RTK inflates some payloads and floors its own `saved_tokens` at zero, so
    `rtk gain` cannot report it; and RTK's `exec_time_ms` is command duration, not added
    overhead, so `latencyMs` stays null rather than claiming a measurement.
13. Implement the static capability resolver (§9). **Done** — ownership, the rule table,
    fail-closed overlap, the pipeline ID, both profiles, and post-apply conflict detection
    wired into `status`. `CapabilityDeclaration` gained `surfaces`, because RFC 0003 resolves
    over a four-part scope while a declaration named only two of the four. One RFC gap is left
    open rather than guessed: `metrics.observe` is observational and does not sit at an
    interception point, so RFC 0003 §Scope and the `metrics.observe` row of the MVP ownership
    table do not compose. Recorded in §17.
14. Implement RTK's installation and configuration plan (§10). **Done** — `plan()` on the
    provider contract, real actions in the plan report, and the brownfield case planning
    nothing. `rtk init` is deliberately not called: invoking it would be a delegated install,
    and RFC 0002 §What this cannot detect requires a reviewed write set recorded in the
    manifest with the upstream version, which has not been done. Writing the single hook entry
    ourselves is the reviewable alternative and keeps rollback a snapshot restore.
15. Implement plan persistence and `apply` (§12). **Done** — the transaction layer built in
    Phase 2.3 is reachable at last. Two defects surfaced only by running it: a succeeding
    action's diagnostics reached the journal and never the user, so Token Harness reformatted a
    file and said nothing; and `apply` returned a report on error-status exits while the envelope
    nulls `data`, so the human and JSON renderings disagreed.
16. Implement `verify`, `rollback`, and `uninstall` (§12). **Done** — the lifecycle closes. PLAN
    §2 criteria 4, 5, 7, 8 and 9 are met; 1, 2, 3 and 6 hold for Claude Code and RTK and need
    breadth rather than new mechanism. Two amendments came out of it: `VerifyReport`'s receipt is
    nullable, because an adopted installation has none and criteria 5 and 8 together require
    verifying anyway; and `uninstall` establishes ownership from a committed journal rather than
    from a digest match, after it offered to delete a hand-written hook whose bytes were identical
    to the one Token Harness writes.
17. Add the Codex and OpenCode harness adapters (§8). **Done** — all three MVP harnesses are now
    detected, which closes PLAN §2 criterion 1. Both register at `config-only`, the tier each can
    actually reach: Codex keeps hook enablement in state no adapter can read, and OpenCode's
    reducing plugin is a generated wrapper with no externally observable receipt. The
    comment-preserving JSONC reader that §17 listed as an open decision now exists, which is what
    makes `opencode.jsonc` readable at all — strict `JSON.parse` rejects the real file.
18. Add the HarnessTrim provider (§11). **Done** — detected, adopted, reconciled against RTK's
    ownership, and measured, with no installation, exactly as §11 divides the roles. This closes the
    last of PLAN §2's nine criteria, so the version is `0.1.0`. Two facts the machine supplied and
    the adapter records rather than papering over: HarnessTrim exposes no version command in any
    spelling, so `version` is null with evidence instead of a guess; and its telemetry is opt-in, so
    the importer's ordinary answer is `unavailable`. *(The first of those was overturned by the next
    release, which added `--version`; the adapter now asks rather than assumes.)*
19. Execute `package-manager-install` (§12). **Done** — the last unimplemented action family a
    `safe` plan can produce. RFC 0004's rules shape it: elevation is refused rather than performed,
    an unknown package manager is refused rather than guessed at, and an installed package is *not*
    reversible by rollback, which the outcome states rather than leaving a "rolled back" report to
    imply otherwise. Verified against the machine: RTK's winget id is `rtk-ai.rtk`, and the manifest
    said `rtk`, which would have matched nothing.
20. Discharge the `0.1.0` quality gates (§8.2). **Done** — and worth saying that item 18 declared
    `0.1.0` against §2's nine *capability* criteria without checking §8.2's eight quality gates,
    which are the list RFC 0005 §Release gating actually gates a release on. Seven are now held by
    `tests/integration/release-gates.test.ts`; the eighth is assigned rather than assumed, per §8.2.
    Two of the assertions were kept only after being shown to have power: a single-claimant control
    proves the overlap scenario's exit 3 comes from the *second* claimant and not from any unowned
    entry, and the hot-path claim reads the hook commands a plan really writes instead of trusting a
    manifest to declare them.

21. Implement `update` (§12, RFC 0001 §CLI contract). **Done** — the last of the nine commands
    RFC 0001 declares, so `PLANNED_COMMANDS` is now empty. Implementing it forced RFC 0004
    §Amended: three of §Provider update policy's six bullets named a mechanism they did not
    specify, a fourth turned out already satisfied by the journal → plan → `versions` chain, and
    the first implied a check nothing performed.

    Four findings the machine supplied rather than the documents:

    - **`winget` was unresolvable, so no winget install had ever run.** `winget.exe` under
      `%LOCALAPPDATA%\Microsoft\WindowsApps` is an App Execution Alias: `statSync` raises
      `EACCES` and `lstatSync` reports a symlink. The probe read the `stat` failure as *absent*,
      so the primary install channel on the primary development platform failed with
      `executable-not-found` — the install argv had been verified by reading `--help`, and the
      resolution in front of it never exercised until `update` asked a channel a question.
    - **`winget show` labels the version in the user's language** — `Versione:` here — so the
      parser is anchored on the untranslated dashes separator, and the fixture is the real
      Italian output.
    - **A compatibility rule's `testedVersions` was never read.** The shipped rule records
      `harnesstrim 0.0.5` and `0.0.6` is installed. Not a live incident — under `safe` HarnessTrim
      is not assignable, so nothing consults the rule — which is worth stating plainly rather
      than dressing up: the data went stale on its own with no code able to notice.
    - **The first `update` collapsed three query outcomes into one verdict** and then printed
      "the channel did not report a version" about a channel that was never invoked. Split into
      `unknown` and `unavailable`.

    Deliberately narrowed, with the reason recorded in the RFC rather than in a comment: pins are
    global only, because honoring a project pin needs the repository-trust mechanism §Repository
    trust assumes and this build has none, and a project pin read without it would let any cloned
    repository choose which version of a tool the user runs.

22. Publish the compatibility, verification-tier, and known-limitations matrices (§8.3). **Done** —
    `docs/matrices.md`, generated from the manifests by `pnpm matrices`, with
    `tests/integration/matrices.test.ts` failing if the committed tables and the manifests disagree.
    A hand-maintained copy of data the code already holds goes stale in one direction only: the
    document keeps promising what the build stopped doing.

    Known limitations stay prose, because most of them are facts about the world rather than manifest
    fields, and reducing "Codex keeps hook enablement in state no adapter can read" to a table cell
    loses the part a reader needs. One constraint is machine-checked: every `limitation` a manifest
    declares must appear there.

    One column was deleted rather than shipped. A generated "what caps this tier" explanation derived
    its reason from the harness alone and produced a row contradicting itself — HarnessTrim on Claude
    is `config-only` beside "the receipt is readable, so interception can be observed". Both halves
    were true of Claude and the sentence was false, because what caps HarnessTrim there is its own
    opt-in telemetry, which no manifest field carries. Generated prose that is plausible and wrong is
    worse than a column that stops at what it knows, so the table now states the gap and the prose
    carries the cause.

    Also closed here: `release-gates.test.ts` asserted a tier on every `HarnessSupport` entry but not
    on every harness a *capability* names — and a capability is what the resolver assigns ownership
    from. Nothing tripped it, which is when such a gap is cheapest to close.

23. Generate the SBOM (§8.3). **Done** — `scripts/package.mjs` emits `dist/package/sbom.json`
    (CycloneDX 1.5) and the document ships inside the tarball. One staged beside the artifact and
    left out of `files` is a build side effect, not a supply-chain document.

    Generated at package time rather than committed, because it carries the bundle's SHA-256 and a
    committed copy would be stale the moment anyone compiled anything.

    It is short, and that is the finding: every runtime dependency in this workspace is a
    `workspace:*` first-party package, so the published tarball declares no dependencies and the
    bundle contains no third-party code. `distribution.test.ts` now asserts that invariant, so the
    SBOM cannot quietly understate what shipped — adding a third-party dependency anywhere in the
    graph fails that test before the generator gets a chance to omit it. Mutation-checked.

    Fixed in passing, found while verifying the tarball: `smoke:install` checked
    `doctor.status === 0` under the name "on a machine with nothing installed" and never created that
    condition. It runs against the real home, so it passed on clean CI runners and failed on any
    developer machine with a configured harness and a coverage gap, which exits 3. A gate that only
    works where nobody looks at it is worse than none — the red is false and it teaches people to
    ignore the output. It now accepts either code `doctor` may legitimately produce and rejects
    anything else, which is what the step is actually for.

    Still open in §8.3 and deliberately not taken: publishing to npm, and the artifact signing that
    goes with it. Both are outward-facing and irreversible, and they are the owner's call, not a
    step to slip into a build.

24. Add the release workflow (§8.3). **Done** — `.github/workflows/release.yml` publishes on a
    `v*` tag using npm **trusted publishing**: OIDC, `id-token: write`, and no token in the
    repository secrets, on a laptop, or in the file. npm signs provenance automatically on that
    route, so `--provenance` is deliberately absent — passing it would be a sign the workflow had
    been written against the token-based mechanism instead.

    Two constraints the documentation supplied and the design had to bend to:

    - **Trusted publishing needs npm 11.5.1 and Node 22.14.0 or newer**, which is *above* the
      RFC 0001 runtime floor `ci.yml` deliberately pins. The release job therefore runs newer and
      asserts the npm version rather than trusting the runner's bundled one. That weakens nothing:
      the job publishes an artifact the matrix already tested at the floor. `distribution.test.ts`
      pins both sides so neither is later "tidied" into matching the other, which would silently
      drop the oldest supported runtime from the matrix.
    - **A trusted publisher cannot be configured before the package exists.** npm's own docs say
      "The package you're configuring must already exist on the npm registry", and the `npm trust`
      command added in February 2026 says the same. So the very first `0.1.0` has to be published by
      hand; every release after it is autonomous.

    `scripts/check-release-tag.mjs` refuses a tag that does not match the staged version, before the
    publish rather than after: a tag is a human gesture and a version is a file, and when they
    disagree the mismatch is otherwise discovered by whoever installs `v0.2.0` and gets `0.1.0`.

    Still open, and the owner's to do: configure the trusted publisher on npmjs.com — or with
    `npm trust github token-harness --file release.yml --allow-publish` — and make that one first
    manual publish. Nothing in this repository can do either, and nothing in it holds a credential.

25. Convert the release workflow to the token route (§8.3). **Done, as a stopgap.** Trusted
    publishing cannot be configured from this account: `npm trust` returned 403, and so did
    `npm profile get` — a plain read of one's own account — which proved the available credential is
    package-scoped and cannot perform account operations at all. The account-level fix needs a second
    factor that is currently unavailable, and npm's 2FA is not something to work around.

    So `release.yml` authenticates with an `NPM_TOKEN` secret and passes `--provenance` explicitly,
    which that route requires and the other forbade. `id-token: write` stays, for provenance rather
    than authentication.

    **The trigger for reverting:** the second factor becomes available again. Then it is three edits —
    `id-token: write` as the only credential, drop `registry-url` / `--provenance` / the `env:` block,
    raise Node to 24 — plus configuring the trusted publisher, which the package now existing makes
    possible. The workflow header carries the same list.

    Recorded because it is a real reduction in safety and not a neutral swap: a secret exists now
    where none did, anyone who can read repository secrets can publish, and npm already warns that
    tokens bypassing 2FA are being restricted for "account changes and direct publishing" — the first
    is blocked today and the second is on the same path.

    `0.1.0` itself was published by hand, which was always going to be true: a trusted publisher
    cannot be configured before the package exists.

RTK and HarnessTrim detection follow once RFC 0007 fixes the verification surface.

## 16. Release gates

### `0.0.x`

Internal architecture and fixtures. No stability promise.

### `0.1.0`

RTK + HarnessTrim, three harnesses, transactional install, verification with declared
tiers, metrics, brownfield adoption.

### `0.2.0`

First additional provider after compatibility validation, goal-based profiles, and the
A/B benchmark matrix.

### `1.0.0`

- stable provider/harness contracts;
- safe upgrade/rollback history;
- at least two release cycles without configuration-loss defects;
- full supported OS/harness matrix;
- documented security model and threat review;
- end-to-end benchmark suite with published raw results.

## 17. Open implementation decisions

These are intentionally deferred to measured spikes or to a triggering need:

1. YAML library and comment-preserving edit strategy.
2. Bundler and executable packaging beyond npm.
3. Whether `core` and `adapters` need to be split further, or `cli` merged in.
4. Whether a SQLite driver is ever needed, per the RFC 0005 triggers.
5. **Whether `0.2.0` offers a measure-alongside profile.** RFC 0003 §Amended: the OpenCode row asks
   the wrong question establishes that `mode: "dryrun"` *is* reachable — not through HarnessTrim's
   installer, but by Token Harness writing the plugin options itself, which is what the JSONC editor
   is for. That would let one provider reduce while another measures what it would have saved,
   filed as `counterfactual` per RFC 0005.

   Not taken for `0.1.0`: it is a different product decision from `safe`, not a better
   implementation of it, and it needs the same two data points the general solver is waiting for —
   a second provider pair, and a fixture showing the counterfactual figures are comparable.

Resolved since the first draft of this plan:

- **What `update` does, and what a pin is** — RFC 0004 §Amended. Pins are global at `0.1.0` and a
  project pin is reported and refused; version discovery belongs to the installation channel, not
  to the provider contract; a compatibility result covers only the versions it records, and below
  `1.0.0` that means exact equality, because "major" is a test that cannot fire for a `0.x`
  provider.
- **Which repository owns the must-keep recall gate** — not this one. §8.2 records why: the gate
  measures a reducer, and Token Harness is not one. It stays on the `0.1.0` list because it is
  still required of the *system*; it is discharged by the providers.
- **How an observational capability is scoped** — it is not. RFC 0003 §Observational
  capabilities are outside this model: the ownership address names an interception point,
  observation has none, and an observer transforms no payload so there is nothing to arbitrate.
  Double counting is prevented by RFC 0005's deduplication keys, not by an assignment. RFC 0006's
  plan transcript lost its `metrics.observe` line.
- CLI exit codes and JSON envelope — RFC 0006.
- Storage backend for `0.1.0` — JSONL, RFC 0001 and RFC 0005.
- Package granularity — three packages, RFC 0001.
- Live-verification mechanism — promoted from a deferred decision to the Phase 2.5
  spike and RFC 0007.
- Provider-manifest signing model — out of scope until an external registry exists,
  which is a post-`1.0` concern.

None of these decisions changes the accepted product or safety contracts.

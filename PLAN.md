# Token Harness — Greenfield development plan

## 1. Objective

Build a cross-platform, local-first control plane that **maximizes useful coding work per included
Claude Code/Codex usage allowance**. It observes real quota windows where the harness exposes them,
reduces avoidable context, applies native model/effort/tool policies before third-party routing,
coordinates compatible reduction providers, verifies real activation, and reports trustworthy
measurements without equating local token counts with opaque subscription quota.

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
| 0009 | Managed lifecycle and compatibility matrix | Accepted — Phase 9, §14 |
| 0010 | Read-only status seam for external consumers | Reserved — Phase 9, §9.4, §15 item 41 |
| 0011 | Quota-aware Claude Code and Codex orchestration | Proposed — post-0.2 product direction |

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

#### Amended: `0.0.7` and `0.1.0` can be asked, and the record above is now history

Everything in this section was true of `0.0.5` and is false of `0.1.0`. It is kept rather than
rewritten, because the analysis is what produced the `0.1.0` design and a reader deserves to see the
constraint that shaped it — but the constraint is gone, and the following flags exist:

| Harness | Narrowing available at `0.1.0` |
| --- | --- |
| claude | `--no-hook`, `--no-instructions` |
| codex | `--no-instructions`, `--hook`, `--global` |
| opencode | `--mode active\|dryrun\|off`, `--min-length <n>`, `--tools <list>`, `--preset <name>` |

`--tools` is `input.tool` used as a filter — the exact line this section cites as unfiltered. The
OpenCode `dryrun` state §17 item 5 called reachable "not through HarnessTrim's installer" is now
reachable *through* it. And `harnesstrim capabilities` publishes all of this as JSON, per harness,
with the produced state named beside each flag, so no future draft has to read upstream source to
find out.

The consequence is §15 item 46, and it is larger than a text change: HarnessTrim stops being the
provider that must be excluded to keep an interception point single-owned, and becomes one that can
be narrowed to what is left over. `plan` currently tells a user running `0.1.0` that its installer
"cannot produce this in isolation", which was a fact about a release from before either of them
started.

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

#### Delivered — all five, by `0.1.0` on 2026-08-03

| # | Landed in | What shipped |
| --- | --- | --- |
| 1 | `0.0.7` | `--no-hook` and `--no-instructions` on claude, `--no-instructions` on codex, and `--mode` / `--min-length` / `--tools` / `--preset` on opencode |
| 2 | `0.0.7` | `--json` on `doctor`, `metrics`, `install` and `uninstall` |
| 3 | `0.0.7` | `harnesstrim capabilities` — JSON, per harness: adapter, surfaces, narrowing flags with the state each produces, and write set |
| 4 | `0.0.7` | `harnesstrim uninstall <harness>`, dry-run by default, removing only what install wrote |
| 5 | `0.0.7`, extended in `0.1.0` | `schemaVersion`, `eventId`, nullable `beforeTokens`/`afterTokens`; `0.1.0` adds `changed` for pass-through rate |

So the sentence at the head of this section — "when each lands, the importer prefers the richer
source and the legacy path becomes the fallback" — is now work rather than a plan, and it is §15
item 43. The write set in item 3 reaches further than the importer: it is the input to
`delegatedInstallReview`, which is why the manifest could pin one upstream version by hand and had
to.

Worth recording plainly, because it is the point of the boundary and not a coincidence: none of this
was built for Token Harness. The task brief in HarnessTrim's own repository says so — "design and
name each item as a normal HarnessTrim feature… a downstream tool happens to consume this CLI too;
that must never require a HarnessTrim-specific concept". Five generic features, useful from that CLI
alone, and a downstream control plane gets to stop guessing. That is the direction the dependency is
supposed to run.

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

## 14. Phase 9 — Managed lifecycle, harnesses, and providers

The objective of this phase, stated as the user-visible result rather than as a list of
workstreams: **one tool installs, updates, verifies, measures and removes the whole
token-saving pipeline, on every harness on the machine, and no channel of waste has two
owners.** `0.1.0` proved the arbitration on one contested pair. Phase 9 makes the pipeline
whole and makes Token Harness the thing that owns it.

§9.0 is what the other workstreams are written against; §9.1 is the mechanism; §9.2 and §9.3 are
what the mechanism is for, and neither can install anything without it; §9.4 is the seam an
ecosystem tool reads, and it mutates nothing; §9.5 is what makes the collection behave as one tool
rather than as five installations that happen to coexist.

One rule spans all of it, and it is the rule the `0.1.0` gates were written to protect: **detection
is broad, mutation is narrow.** Adding a harness or a provider to the registry makes it *visible*.
Making it manageable additionally requires a compatibility row backed by a fixture, and nothing
below shortens that.

### 9.0 Observation spike — the harnesses and installers of the second machine

Phase 2.5 sits before the adapters in §4 because "discovering it late would force a rewrite of
every adapter". The same applies to Hermes, Pi and OMP, and more sharply: none of the three has
been seen by this build. Their configuration formats, interception points and enablement semantics
are unknown here, and the three known ones each broke a different assumption — Claude Code routes
shell through a second tool family on Windows, Codex keeps enablement in unreadable state, and
OpenCode's real config is JSONC that `JSON.parse` rejects.

No production code. Per harness, record on a real installation:

- version, and the command that reports it;
- configuration files, user and project scope, with absolute paths and the parser each needs;
- interception points, as exact key paths, with a real example of a configured entry;
- tool families, and whether any shell-executing family is reachable without being matched;
- whether enablement or trust lives in separate state, and whether it is readable from outside;
- whether anything externally observable records that an interception ran — which decides the
  achievable tier, and `config-only` is the expected answer rather than a disappointing one;
- what HarnessTrim's own installer writes there: the exact write set and artifact digests at the
  observed upstream version, which is what RFC 0002 requires before any delegated install.

Deliverable: `docs/spikes/9.0-harness-observation-log.md`, in the shape of the Phase 2.5 log —
every claim carrying a path or a command transcript.

Acceptance:

- nothing recorded from a README or an upstream issue; a claim without local evidence is written
  as an open question instead;
- each harness has a proposed tier with the reason, and a proposed tested-version range of exactly
  the version observed;
- where a harness cannot be given an interception point, that is the finding, and the harness is
  queued as detection-only rather than dropped.

### 9.1 Managed lifecycle and compatibility

RFC 0009 extends the control plane from adopting installed tools to installing and updating
compatible tools through the same plan/apply/verify/rollback lifecycle.

Implement in this order, which the RFC states with the part already built named rather than
re-requested:

1. package-inventory capture, the package-ownership test, and a receipt that distinguishes a
   reverted package from an unreverted one. The `package-manager-install` executor already exists
   (§15 item 19); `rollbackData: 'package-inventory'` is the declared value nothing implements;
2. JSONC mutation beyond `appendJsoncRootArray` — object-member and nested-array edits, at the same
   standard of refusing an edit it cannot locate exactly;
3. OpenCode managed-plugin rows, beginning with the observed schema and fixtures for clean,
   brownfield, update, drift, rollback and uninstall states;
4. reviewed installation/update channels for RTK and HarnessTrim; and
5. matrix rows for additional harness and provider versions only after their fixtures pass.

Acceptance:

- `doctor` reports every detected version, while `plan` refuses managed mutation outside a reviewed
  matrix row with the missing schema/fixture named;
- a stored update plan pins the resolved package version and rejects inventory, version, config or
  compatibility drift before mutation;
- failures restore configuration, and restore package inventory where the channel can report one
  and Token Harness owns the package — a channel with no inventory is reported as unreverted rather
  than exempted;
- a managed OpenCode plugin preserves JSONC comments, trailing commas and user plugin entries; and
- Windows, macOS, Linux and WSL fixtures cover every shipped matrix row.

### 9.2 Harness expansion

The harness admission sequence, symmetric with the provider one below:

```text
research
  -> interception points observed on a real installation
  -> config schema, parser, and ownership scopes
  -> manifest and tool families
  -> verification tier per RFC 0007, config-only where nothing is observable
  -> fixture suite: absent, partial, healthy, broken, user-modified, brownfield
  -> matrix row
  -> opt-in release
```

Order, by evidence available rather than by audience size:

1. **Hermes Agent.** HarnessTrim ships a plugin adapter for it (`harnesstrim install hermes`), so
   the interception point is already implemented upstream instead of needing to be discovered. And
   there is a discrepancy to close either way: HarnessTrim's manifest already declares
   `~/.hermes/harnesstrim-metrics.jsonl` among its metrics locations, so Token Harness reads a
   Hermes path today while having no Hermes adapter, no tested version range, and no tier for it.
   Importing a harness's telemetry without admitting the harness is the narrower kind of the same
   dishonesty §8.2 exists to prevent.
2. **Pi.** HarnessTrim ships an extension for it (`harnesstrim install pi`), on the same footing as
   Hermes. Both are currently reported as unmanaged context per §11 §6.2 — that clause is what this
   item replaces.
3. **Oh My Pi (OMP).** A bridge exists in `harness-remote`, which is evidence of a *control*
   surface, not of an interception point. It is admitted only once an interception point is observed
   on a real installation, and stays detection-only until then.

Then a researched wave, held to the same gates and none of it admitted from a feature list: Gemini
CLI, GitHub Copilot CLI, Cursor CLI, Amp, Crush, and Cline. `docs/provider-landscape.md` §Harness
landscape holds that queue, and separates what has been observed from what has only been named; an
entry there is not a support claim.

The first two items unlock something the provider queue cannot: **HarnessTrim becomes a managed
provider rather than an adopted one.** RTK declares Claude Code alone, so on Hermes and Pi nothing
contests `shell.output.reduce` — the exclusion recorded in §11 is a fact about Claude, Codex and
OpenCode, not a property of the pair. The first managed HarnessTrim installation therefore happens
on a harness where the arbitration is trivially satisfied and the lifecycle is the only thing under
test, which is the right order to prove a lifecycle in.

Acceptance for each added harness:

- a declared verification tier, `config-only` where nothing is observable, and never implicit;
- a matrix row and platform coverage per §9.1, or detection-only with the reason stated;
- no provider claims it until that provider's own fixture on that harness passes;
- `metrics` never imports from a harness path the registry does not know.

### 9.3 Provider expansion

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
4. LiteLLM as the gateway and telemetry seam for routing; Claude Code Router is evaluated
   at the same seam as the agent-native routing surface;
5. one routing-policy owner, evaluated between RouteLLM, vLLM Semantic Router, and LLMRouter;
6. one broad context owner, evaluated between Headroom and Context Mode;
7. LLMLingua behind a provider that supplies the missing harness lifecycle;
8. Caveman as an opt-in output policy.

The first additional provider is also what unblocks the deferred resolver work: goal-based
profiles are designed against two provider pairs rather than one.

Headroom and Context Mode remain alternatives until a specific composition study says
otherwise. Caveman remains opt-in until its instruction overhead is included in the
break-even calculation. Dejavu remains non-default until RTK ordering and native
Windows support are resolved.

#### The admission set for this phase, and the channel each one closes

The queue above ranks candidates by how different their source of waste is. Implementation order is
not the same question, because two of the highest-ranked entries carry unresolved admission gates
and one does not. This is a sequencing decision inside that queue, not a re-ranking of it, and it is
written down so the difference is visible:

| Channel of waste | Owner after this phase | Capability | Contest with what ships |
| --- | --- | --- | --- |
| Shell command, before execution | RTK | `shell.command.rewrite` | — |
| One command's output | RTK, or HarnessTrim where RTK declares no support | `shell.output.reduce` | resolved at `0.1.0` |
| Output repeated across runs | Dejavu | `shell.output.deduplicate` | chainable with RTK, order undecided |
| Generic tool results | HarnessTrim | `tool.output.reduce` | — |
| MCP tool schemas | Lazy MCP | `mcp.schema.lazy` | **none** |
| The model's own verbosity | Caveman | `model.output.terse` | **none** |
| Always-loaded instructions | HarnessTrim skills | `instructions.progressive` | file-level, see below |
| Repository context | repowise, later | `repo.context.retrieve` | needs a size cap and an attribution fixture |
| Conversation history | harness-native compaction | — | not a provider surface |

Implementation order:

1. **Lazy MCP.** MIT, and the only candidate whose capability no shipped provider claims — nothing
   arbitrates, so the resolver work is a declaration rather than a rule. Its gates are all local and
   testable here: Windows packaging, recursive discovery, schema byte accounting, restoration of the
   original MCP registry on uninstall, and adoption of a proxy the user configured by hand.
2. **Caveman.** MIT, `model.output.terse` unclaimed, and it reaches a channel neither RTK nor
   HarnessTrim touches at all. Opt-in, with the instruction overhead inside the break-even
   calculation rather than beside it — a provider that spends 200 tokens of instruction to save 300
   is a rounding error being reported as a feature.

   It also surfaces something the resolver does not yet model. Caveman and HarnessTrim both write
   marker-fenced instructions into the same file — `CLAUDE.md`, `AGENTS.md` — so they contest a
   *file region*, not a capability. `PatchMarkerBlockAction` already makes each block owned and
   reversible, and RFC 0003 arbitrates over interception points, which an instruction file is not
   one of. Two providers writing distinct owned blocks into one file is legitimate; two providers
   writing the *same* block is a conflict nothing currently detects. That gap is admitted with
   Caveman or Caveman waits.
3. **Dejavu.** Last of the three, and non-default when it lands, for the two reasons already
   recorded: RFC 0003 §Dejavu policy asks seven questions that only an ordered-chain integration
   test can answer, and native Windows is unsupported upstream — which on a Windows-first project
   means the platform declaration says so rather than the provider being quietly absent there.

Excluded from this phase, each for a reason already accepted rather than a new one: Headroom and
Context Mode contest `tool.output.reduce` with HarnessTrim, so admitting either into a
maximum-savings profile is exactly the fail-closed violation RFC 0003 §Context provider policy
forbids; LLMLingua is an engine with no lifecycle; and the routers need the capability and
attribution-class RFC named below before a manifest can honestly describe them.

LiteLLM is a gateway substrate, not by itself evidence of intelligent routing or token
savings. Claude Code Router is called "router" but is first an agent-native gateway; its
routing rules and logs make it independently adoptable once the capability exists. RouteLLM,
vLLM Semantic Router, and LLMRouter remain alternative owners of a model request.
Before any of them can be admitted, a new RFC must define the model-routing capability and a
cost/quality attribution class: routing a request to a cheaper model is never folded into
RFC 0005's exact or estimated token-saving totals.

### 9.4 The read-only status seam, and its first consumer

`harness-remote` controls coding-agent harnesses from a phone or a second machine, over the
OpenCode HTTP server and ACP bridges for PI, OMP and Claude Code. Stated plainly, because the
alternative is a category error that costs an adapter: **it is not a provider under RFC 0002.** It
intercepts no payload, owns no interception point, transforms nothing, and produces no saving to
attribute. It has no manifest to write.

What it is, is the first thing outside this repository that wants to *read* what Token Harness
knows — which harnesses are present, which pipeline is installed, whether verification passed, and
what was saved — from a process that is not a terminal. That surface already exists in one form:
RFC 0006's `--json` envelope on `doctor`, `status`, `verify` and `metrics`. Nothing is missing
functionally. What is missing is a promise about it.

So the deliverable here is an RFC, not an adapter, and it defines only:

- which envelopes are a consumed contract rather than a rendering, and the compatibility policy for
  their `schemaVersion` — today a consumer's only guarantee is that the tests would notice a change,
  which is not a guarantee made to the consumer;
- how a reader locates the state root without re-deriving RFC 0004's path rules;
- what a reader is guaranteed never to find in it: RFC 0005 §Privacy already forbids prompts,
  arguments and raw output entering the store, and a read surface is the place that promise becomes
  externally checkable;
- that the seam is read-only.

That last point is a boundary, not a phase ordering. Accepting a mutation over any remote surface
needs the repository-trust mechanism RFC 0004 §Repository trust assumes and this build does not
have — the same absence that keeps version pins global at `0.1.0` (§15 item 21). Until it exists, a
remote `apply` would let whatever is on the other end of a socket choose which tools run on the
user's machine, and there is no version of that which is a smaller decision than it sounds.

`squeezed` is out of scope and named here so the question is answered once: it is a Blender desktop
assistant, and it shares an author with this repository and nothing else.

### 9.5 The pipeline as one tool

Five managed providers across five harnesses is not one tool merely because one CLI can reach them
all. It becomes one tool when a user states an intent once and every subsequent operation is about
the pipeline rather than about its members. Four things are missing for that, and none is cosmetic.

**Goal-based profiles.** RFC 0003 §0.2.0 already specifies them, including the `goals` block
already reserved in `token-harness.yaml` and the `balanced` profile deliberately absent rather than
aliased. They were deferred for one stated reason — "it needs more than one provider pair to be
designed against, so it is deferred rather than guessed" — and §9.3 supplies three more pairs. The
resolver converts goals into owners using installed harnesses, OS support, provider availability,
license policy, verified compatibility and user overrides, and `plan` keeps explaining every
selection *and every rejection*, which is what stops a profile from degenerating into an installer
recipe. A `max` goal set is the one the user actually asks for; it is legitimate only because every
channel in the §9.3 table has exactly one owner, and it must fail closed rather than co-enable two
claimants when a provider is missing.

**One lifecycle over the set.** `apply` already executes a multi-provider plan; the gaps are on the
other three verbs. `update` must cover every managed provider in one transaction and report the ones
whose channel could not answer, distinctly from the ones already current. `uninstall` must remove in
reverse dependency order and preserve anything the user owns. `rollback` must restore a partially
applied *pipeline*, not a partially applied action — which is the case where a package survives, and
the receipt says so.

**One pipeline identity.** The pipeline ID is already derived from the ordered owner list, so it
changes when the composition changes. `status` should lead with it: the channels, their owners, the
tier each reaches, and the drift on any of them — one table, not five provider sections a reader has
to compose mentally.

**One savings figure that is still honest.** Per-channel attribution with the measurement classes
kept apart is the whole difficulty. Five providers reducing five different channels must not sum
into a single number that mixes exact token counts, character-derived estimates and counterfactuals;
an overlapping stage must be counted once; and a channel with no measurement reports that rather
than a zero. RFC 0005's deduplication keys and measurement classes already carry this, and the work
is a report that reaches five providers without loosening either.

Acceptance:

- a goal set resolves to exactly one owner per channel, or fails closed naming the unowned channel
  and the missing provider;
- `balanced` and `max` exist as goal sets, and neither is an alias of `safe`;
- `update`, `uninstall` and `rollback` each act over the whole pipeline with one receipt;
- `status` shows one pipeline, its ID, and per-channel owner, tier and drift;
- `metrics` reports per channel and per provider, never merging measurement classes, and the total
  of a mixed pipeline is refused rather than approximated;
- removing Token Harness leaves every user-managed installation intact, on all five harnesses.

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

    Still open in §8.3 at the time this item was written, and deliberately not taken then: publishing
    to npm, and the artifact signing that goes with it. Both are outward-facing and irreversible, and
    they are the owner's call, not a step to slip into a build.

24. Add the release workflow (§8.3). **Done** — `.github/workflows/release.yml` validates the
    release gates and verifies that the tag matches the staged package version. It does not publish:
    the publishing job was removed again, so a tag proves the gates passed and nothing more.

    Publishing has since happened, by hand: `token-harness` `0.1.0` on 2026-08-01 and `0.1.1` on
    2026-08-02. Two of §8.3's six bullets are therefore closed — the npm package and `npx
    token-harness doctor` — and one that reads as closed is not. The tarball carries the registry's
    own signature, which every npm package gets; it carries no build provenance attestation, so
    "sign or attest release artifacts" is still open, and item 23's phrasing above is left as it was
    written rather than retrofitted into having anticipated this.

### Phase 9 queue

Items 1–24 are the `0.1.0` record. What follows is the Phase 9 work, in dependency order, one PR
each unless an item says otherwise. Three of them need a machine with Hermes, Pi and OMP installed
and are marked **[second machine]**; the rest need nothing that is not in this repository, so they
can proceed in parallel with the observation spike rather than waiting behind it.

Items 25 to 31 are **done** — PRs #39, #40, #41, #42, #43, #62 and #66. Items 43a and
43d are also **done** — #45 and #46/#47. Item 46 then landed for the reversible Claude and
Codex paths through #58, #65, #67 and #68. OpenCode is deliberately adoption-only in 0.1.3:
its delegated installer creates a dependency tree, so treating it as a reviewed configuration
write set would make rollback dishonest. The queue below is reconciled to that shipped decision
rather than continuing to present it as merely pending.

25. **Stop reading a harness the registry does not know. Done** — #39.
    `harnesstrim`'s manifest declares
    `~/.hermes/harnesstrim-metrics.jsonl` among its metrics locations while no Hermes adapter, tested
    range or tier exists. Remove that location until item 30 admits Hermes, and add the assertion
    that makes the gap impossible to reintroduce: every metrics location a provider declares belongs
    to a harness in the registry, or is project-relative and harness-neutral.

    Small, and first because it is the one live inconsistency rather than a future feature.
    Regenerate `docs/matrices.md`; the metrics-sources table changes.

26. **The observation spike (§9.0). [second machine] Done** — #40,
    `docs/spikes/9.0-harness-observation-log.md`, taken on Zorin OS with Hermes 0.19.0, Pi 0.83.0,
    OMP 17.2.4, OpenCode 1.18.11, Codex 0.142.0, RTK 0.44.0, HarnessTrim 0.0.6 and no Claude Code.

    Four findings the documents could not have supplied, each of which shapes an item below:

    - **Hermes has a real receipt.** `~/.hermes/harnesstrim-metrics.jsonl` was live — 111 events,
      the gateway process environment carrying `HARNESSTRIM_MODE=active` and telemetry on. So Hermes
      is the *second* harness above `config-only`, and the only one reachable without a model call.
      The attributed one-operation-to-one-event delta is the step still outstanding before a tier-3
      claim, and the log says so rather than rounding up.
    - **Hermes' enablement is readable.** A plain `plugins.enabled` list in `~/.hermes/config.yaml`,
      no trusted-hash equivalent of the Codex finding, readable while the harness runs.
    - **Pi is `config-only` and will stay there.** The extension patches the content it returns and
      writes nothing; there is no artifact a deterministic probe could read.
    - **OMP has no HarnessTrim installer.** `install` covers claude, codex, hermes, opencode and pi,
      and there is no `adapter-omp` asset. So OMP cannot be delegated for, and its hooks were found
      hand-written with no `.installed` marker and no observed execution. Item 32 inherits that.

27. **Package inventory capture, ownership, and receipt (§9.1 item 1). Done** — #41.
    Implements the declared
    `rollbackData: 'package-inventory'`. Capture the inventory for the channels that can report one
    (`npm`, `cargo`, `winget`, `homebrew`, `uv`, `pipx`); record which channel answered and which
    could not; decide ownership from the transaction journal rather than from presence, exactly as
    `uninstall` already does. A rollback that restores an inventory says so; one that cannot still
    says so, and never the other way round.

    Acceptance: a mid-plan failure after an install reports the package as reverted only where the
    inventory was captured and the package was ours; the RTK plan's `rollbackData` moves off `none`
    for inventory-capable channels and the comment recording why it was `none` is replaced by the
    behaviour, not deleted.

28. **JSONC object-member and nested-array mutation (§9.1 item 2). Done** — #42.
    Extend `state/jsonc.ts` beyond
    `appendJsoncRootArray`: set or insert an object member, and append into a nested array, keeping
    comments, trailing commas and formatting, and refusing an edit it cannot locate exactly. The
    refusal is the feature — a CST editor that approximates is how a user's comments disappear.

    Acceptance: property test over real `opencode.jsonc` shapes asserting that every byte outside the
    edited region is unchanged; an ambiguous or absent target is a planning error naming the path and
    the expression it could not resolve.

29. **`CompatibilityRow` and the managed-mutation gate (RFC 0009). Done** — #43,
    `packages/core/src/domain/compatibility-rows.ts` with `tests/integration/gate-rfc0009.test.ts`.
    The row type, the lookup, the
    classification of an out-of-range version as `unknown-newer` / `unknown-older` / `below-range`,
    and `plan` refusing managed mutation outside a row with the missing schema or fixture named. Keep
    it distinct from `CompatibilityRule` as RFC 0009 §This is not RFC 0003's compatibility rule
    requires; a row must not be reachable from the arbitration path.

    Acceptance: a provider/harness/version combination with no row is detected and reported by
    `doctor` and refused by `plan`, with distinct exit codes for "nothing to do" and "cannot do this
    safely"; a lockfile, a successful probe and a matching major version each fail to satisfy a row.

30. **Hermes harness adapter. [second machine] Done — #62.** Written against item 26's log:
    detection, config discovery, inspection, declared tier, tested range and fixture coverage are
    shipped. Hermes is read-only from Token Harness today: the adapter can detect the HarnessTrim
    plugin, read enablement and verify/measure it, but does not enable or install it.

31. **Pi harness adapter. [second machine] Done — #66.** The adapter detects the HarnessTrim
    extension in Pi's auto-loaded extension directories and verifies the configuration. Pi remains
    read-only from Token Harness today; managed installation is item 33.

32. **OMP adapter admission. [second machine]** Item 26 observed OMP 17.2.4's post-hook surface but
    HarnessTrim 0.0.6 had no OMP installer, so the original queue allowed either an adapter or a
    recorded refusal. That premise is stale: HarnessTrim main now ships `adapter-omp`,
    `install omp`, `uninstall omp`, a machine-readable OMP write set, and baked
    mode/min-length/metrics configuration.

    This reopens OMP as a real managed-harness candidate, but it does **not** create a compatibility
    row by documentation. Re-run the second-machine observation against the current HarnessTrim
    build, prove the exact hook/config artifacts and whether an attributed metrics receipt is
    observable, then add the adapter/row at the tier the machine proves. Until that fixture exists,
    Token Harness must continue to make no OMP mutation.

33. **HarnessTrim as a managed provider on Hermes and Pi. [second machine]** The first managed
    HarnessTrim installation, and the reason it is first: RTK declares Claude Code alone, so nothing
    contests `shell.output.reduce` there and the lifecycle is the only thing under test. A
    `DelegatedProviderInstallAction` with the write set and artifact digests item 26 recorded, a
    containment boundary, snapshot rollback, and the resolver assigning the scope for real rather
    than excluding it.

    Acceptance: `plan` under `safe` now contains a HarnessTrim install action on Hermes and Pi and
    still contains none on Claude, Codex or OpenCode; a write outside `affectedPaths` but inside the
    boundary fails and names the path; uninstalling restores the pre-install snapshot and never calls
    an upstream uninstaller that was not declared available.

34. **HarnessTrim managed on OpenCode (§9.1 item 3).** The managed-plugin row: the wrapper file, the
    configuration directory's package manifest and lockfile inside the reviewed write set, and the
    JSONC editor from item 28 doing the config edit. Fixtures for clean, brownfield, update, drift,
    rollback and uninstall.

    Acceptance: a user plugin entry and a user dependency both survive install and uninstall; the
    plugin entry alone is never reported as a complete installation.

35. **Lazy MCP provider (§9.3).** `mcp.schema.lazy`, which nothing else claims. Manifest with license
    and channels, detection, plan and uninstall restoring the original MCP registry byte-for-byte,
    metrics or an honest `unavailable`, brownfield adoption of a proxy the user configured by hand,
    and matrix rows. Windows packaging is an admission gate, not a follow-up.

    Acceptance: uninstall restores the pre-install MCP registry exactly; the schema bytes it claims to
    have avoided are measured, not asserted; a hand-configured proxy is adopted rather than
    overwritten.

36. **Caveman provider, and instruction-file region ownership (§9.3). Partially done.**
    `model.output.terse` remains to be admitted as an opt-in provider, with the instruction overhead
    inside the break-even figure. The provider-neutral prerequisite is done in #76:
    `patch-marker-block` actions are attributed while planning, distinct regions in one instruction
    file may coexist, and two providers claiming the same file + marker pair produce the hard
    `marker-region-contested` conflict before apply.

    Acceptance: two providers with distinct owned blocks in one `AGENTS.md` both apply and both roll
    back independently; two providers claiming the same marker block are a conflict reported before
    apply; a reported saving from terser output is net of the instruction it costs.

37. **Dejavu provider (§9.3), non-default.** The seven questions in RFC 0003 §Dejavu policy answered
    by ordered-chain integration tests, not by prose. Native Windows unsupported upstream is declared
    in the platform support rather than discovered by a user.

    Acceptance: each of the seven has a test that would fail if the answer changed; exit codes survive
    the full chain; the original raw output is retrievable; incremental savings are attributable per
    stage with no double counting.

38. **Goal-based profiles (§9.5, RFC 0003 §0.2.0).** The `goals` block, resolution from goals to
    owners, `balanced`, and the `max` goal set. Amend RFC 0003 with what three additional provider
    pairs teach, since the deferral was explicitly waiting for them.

    Acceptance: exactly one owner per channel or a closed failure naming the unowned channel;
    `balanced` and `max` are neither absent nor aliases of `safe`; `plan` explains every selection and
    every rejection; a missing provider narrows the pipeline instead of co-enabling two claimants.

39. **Pipeline-level `update`, `uninstall`, `rollback`, and `status` (§9.5). Done — #77, #79, #80.**
    The mutating lifecycle already executes the whole selected provider set through one transaction
    and one receipt: `update` accumulates all admitted upgrades before its single
    `executeTransaction`, `uninstall` does the same for owned removals, and `rollback` reverses
    one committed transaction as a unit. #80 adds the missing dependency rule: an applied ordered
    chain is removed in reverse `ResolvedCapability.order`, while contradictory or ambiguous
    recorded orders fail closed. #77/#79 make `status` lead with the applied pipeline ID, channels,
    ordered owners, declared tiers and drift, sourced from the receipt plus live configuration.

40. **Per-channel metrics over five providers (§9.5). Partially done — #82, #83, #85.**
    #82 makes raw-to-final accounting executable rather than aspirational: ordered stages are
    measured once, and missing identity, mixed classes/units, broken boundaries, counterfactuals
    and overlapping baselines fail closed. #83 adds the actual per-channel report from the same
    live applied-pipeline inventory as `status`, with explicit `measured`, `unmeasured`,
    `attribution-unavailable` and `incomparable` states while keeping provider rows marginal.
    #85 closes the provider-neutral mixed-total gap: `pipelineTotal` is numeric only for one fully
    comparable applied channel; unattributed/incomparable residue refuses a partial total, and
    independently measured channels return `cross-channel-comparability-unproven` instead of being
    added without evidence. The same PR fixed channel attribution so a known different
    `toolFamily` cannot become residue for another channel.

    What remains is evidence breadth, not aggregation semantics. RTK history and current HarnessTrim
    telemetry still import with `pipelineId` / `pipelineOrder` null, so their historical rows
    correctly report attribution unavailable rather than being assigned to today's configuration.
    Item 40 closes after the admitted provider set can emit or otherwise prove shared
    operation/pipeline identity across real chains and the five-provider fixtures exercise it.

41. **RFC 0010, the read-only status seam (§9.4). Done.** `docs/rfcs/0010-read-only-status-seam.md`
    fixes the consumed JSON envelopes, schema-version compatibility policy, canonical state-root
    locations, privacy boundary, and the prohibition on remote mutation without a separate trust RFC.

42. **`0.2.0` release gates (§16). Partially done.** #75 closes the build-provenance part of
    §8.3: the tag workflow packs the exact publishable tarball, attests SLSA provenance and the
    shipped CycloneDX SBOM against it, and retains the attested artifact without publishing it.
    #82/#83/#85 ship the provider-neutral per-channel accounting, report and explicit mixed-pipeline
    total refusal. The A/B benchmark matrix, five-provider attribution evidence and regenerated
    matrices remain.

43. **Consume HarnessTrim's machine-readable surfaces. Done — #45, #46/#47, #73.**
    43a consumes the capability/write-set declaration and 43d consumes native event identity/token
    counts. #73 closed 43b and 43c after verifying that their original premises no longer exist:
    Token Harness has no HarnessTrim prose parser to replace, and its journal-owned surgical
    uninstall is stronger than delegating removal to a second ownership implementation:

    a. **Done — #45: `capabilities` supplements the statically declared capability set.** `harnesstrim capabilities`
       emits JSON: per harness, the adapter, the surfaces, the *narrowing flags with what each
       produces*, and the write set. Read it at detection, compare it against the manifest
       declaration, and report a disagreement as drift naming both sides. The manifest keeps its
       declaration — a provider that cannot be asked must still be describable — but it stops being
       the only source, which is what let a rule sit at `0.0.5` while `0.0.6` was installed (§15
       item 21).

       The write set is the part that changes the lifecycle rather than the reporting: RFC 0002
       requires a *reviewed* write set for a delegated install, and reviewing it by hand is what
       pinned `delegatedInstallReview.upstreamVersion` to one release. A declared write set does not
       remove the review; it turns it into a fixture that compares declaration against what an apply
       actually wrote. Cheap, repeatable, and it fails when upstream changes what it writes.

    b. **Closed by architecture — no prose parser remains.** Token Harness does not consume
       `harnesstrim doctor` or `harnesstrim metrics` prose. Detection asks `--version` and
       consumes the machine-readable `capabilities` document; metrics import reads the native JSONL
       stream directly. Calling the upstream summary commands would add a second, less precise source
       of truth, so there is nothing to replace here.

    c. **Closed by ownership policy — keep Token Harness' surgical uninstall.** The shipped
       `uninstall` is no longer restore-only: it plans `remove-owned-change` from committed journal
       ownership, verifies the live digest/marker, and executes the removals transactionally. Although
       HarnessTrim now ships `uninstall <harness> --apply`, delegating removal would introduce a
       second implementation of ownership and weaken the invariant that Token Harness removes only
       artifacts it can prove it wrote. `upstreamUninstallAvailable` remains capability metadata;
       it is not a reason to bypass the journal-owned removal path.

    d. **Done — #46/#47: the importer consumes native event identity and token counts.** `TrimEvent` now carries `schemaVersion`, a producer
       `eventId` from `randomUUID`, `beforeTokens`/`afterTokens` — null where the emitting path has
       no tokenizer — and, at `0.1.0`, `changed`, which marks a recorded pass-through. So dedup uses
       the native ID instead of the synthesized identity RFC 0005 specified for a stream that had
       none; a token count is a token count where one exists; and the pass-through rate becomes
       reportable. Character-only legacy lines still parse as schema 0 and stay `estimated-local`,
       and the two must not merge — which is the same rule as before, now with two real classes in
       one stream instead of one.

44. **Refresh the tested version ranges, with fixtures rather than with numbers.** On the development
    machine today `doctor` prints four notes — Claude Code 2.1.220, OpenCode 1.18.11, RTK 0.44.0 and
    HarnessTrim 0.1.0 are each newer than any tested version — and the compatibility rule in
    `planner/rules.ts` still records `rtk 0.42.0` and `harnesstrim 0.0.5`. Four honest notes on a
    stock machine is the failure RFC 0006 §Exit codes warns about: it teaches the reader to ignore
    the section.

    Extending a range means exercising the fixtures at the observed version and recording the row,
    per §9.1 and RFC 0009 — not editing a constant. Where a version cannot be exercised, the range
    stays and the note stays, because the note is true.

45. **An update that outdates reviewed data is refused, not performed. Done — #72.** This is the gap between
    "Token Harness can update a provider" — which item 21 built — and "Token Harness can be trusted
    to update it". `update` resolves an exact version from the channel and installs it; nothing then
    checks whether the manifest's reviewed write set, the compatibility rule's tested versions, or a
    `CompatibilityRow` still describe what is now on disk. HarnessTrim `0.0.5` → `0.1.0` is the
    worked example: the write set was reviewed at `0.0.7`, the rule records `0.0.5`, and the
    installer gained four narrowing flags in between.

    Planning an update therefore also resolves what the *target* version declares, and a managed
    update outside a row is refused with the missing fixture named — the item 29 gate, applied to
    the provider dimension. An adopted installation is still updated freely, because Token Harness
    owns nothing there; the refusal protects the case where it does.

    Acceptance: an update whose target version leaves the reviewed write set behind is refused
    before the package manager is invoked, naming the version, the row and what changed; a provider
    with no managed installation updates as it does today; the refusal is a distinct exit code from
    a channel that had nothing to offer.

46. **HarnessTrim managed where the lifecycle is reversible. Partially done.** Claude and
    Codex now have reviewed managed paths and shipping compatibility rows. #58 made the reviewed
    delegated install executable, #65 added the Codex review, #67 shipped the Codex row, and #68
    made the assignability decision per harness so a bare apply can install every covered path.

    **OpenCode is not pending under the current safety model.** Its installer writes a plugin wrapper,
    package metadata and a `node_modules` dependency tree. A dependency tree is not a reviewed
    configuration write set; snapshotting it on every apply would be slow and would restore an
    upstream installation rather than Token Harness's configuration change, while excluding it from
    rollback would overstate reversibility. Therefore OpenCode stays detect/adopt/verify/measure-only
    until a different reversible packaging model exists.

    The remaining managed-HarnessTrim work for 0.2.0 is item 33: Hermes and Pi, whose adapters are
    now present and whose write sets can be reviewed without the OpenCode dependency-tree problem.

### Order after HarnessTrim `0.1.0` — reconciled at `0.1.3`

The shipped baseline has already completed 43a, 43d, the Hermes/Pi adapters, and the reversible
Claude/Codex part of item 46. The remaining dependency order is therefore:

1. **33** — manage HarnessTrim on Hermes and Pi, using the adapters already shipped in #62/#66.
2. **32** — re-observe OMP against HarnessTrim's new OMP installer, then admit only the tier and
   write set the real machine proves.
3. **35**, then the remaining provider work in **36** and **37** — add Lazy MCP on an unowned
   channel, then Caveman and Dejavu. The generic marker-region conflict prerequisite of 36 is done.
4. **38**, then finish **40** — goal-based profiles and the remaining five-provider
   attribution evidence. Pipeline-level lifecycle/status is complete in #77/#79/#80, and the
   provider-neutral per-channel accounting/report/mixed-total refusal is complete in #82/#83/#85.
5. **42** — finish the A/B matrix and regenerated matrices. RFC 0010, pipeline lifecycle,
   provider-neutral channel metrics and build provenance are already shipped.

OpenCode managed installation is not in this sequence while the current dependency-tree installer
remains incompatible with the transactional rollback contract.

## 16. Release gates

### `0.0.x`

Internal architecture and fixtures. No stability promise.

### `0.1.0`

RTK + HarnessTrim, three harnesses, transactional install, verification with declared
tiers, metrics, brownfield adoption.

### `0.2.0`

The managed lifecycle of §9.1; Hermes and Pi admitted with declared tiers; HarnessTrim managed
on reviewed reversible paths (with OpenCode explicitly adoption-only under the current installer);
at least one additional provider on a channel nothing owned before; goal-based
profiles with `balanced` and `max`; pipeline-level `update`, `uninstall`, `rollback` and `status`;
per-channel metrics with the measurement classes apart; and the A/B benchmark matrix.

The managed lifecycle is listed first because everything after it assumes it. A new provider that
cannot be installed and a new harness on which nothing can be planned are both detection-only, which
is a smaller release than this line has been promising.

What `0.2.0` claims, in the form a user can check: one command installs the pipeline on every
harness present, one command updates it, one removes it without touching anything they configured by
hand, and every channel of waste in §9.3's table has exactly one owner or is honestly reported as
having none. `0.1.0` proved that arbitration is possible on one contested pair; `0.2.0` is the claim
that the whole pipeline is one thing.

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


## 18. Phase 10 — Quota-aware Claude Code/Codex efficiency

RFC 0011 changes the next product milestone from "add more token reducers" to
**maximize accepted coding work inside the usage allowance the user already pays for**.

This phase is intentionally additive to the existing safety architecture. The transaction engine,
provider ownership, rollback, verification tiers, and strict metrics classes stay. What changes is
the optimization objective and therefore the admission order.

### 18.1 P0 — Live budget observability — Done (#93)

`budget` now has the provider-neutral window model, Codex app-server reader, explicit Claude
unavailable state, separate five-hour/weekly buckets, reset timestamps/credits, confidence/source,
and no credential scraping or credit redemption. A later observational tranche adds an optional
cacheless cclimits Claude fallback: OAuth-backed companion data is `reported`, fresh local Claude
cache is `cached` and excluded from live pacing, and stale cache is rejected. Token Harness never
reads cclimits credentials or installs the companion. Unknown backend state remains unknown.

Implement a provider-neutral usage-window model and:

- `token-harness budget`;
- `token-harness budget --json`;
- a Codex reader based on the installed app-server's `account/rateLimits/read` contract;
- Claude Code usage/status discovery with an explicit compatibility fixture for every parsed native
  surface;
- reset timestamp, window duration, used/remaining percentage, confidence and source;
- five-hour and weekly buckets kept distinct;
- reset-credit inventory as read-only data;
- `unknown` rather than an estimate when a live bucket cannot be proved.

Acceptance:

- Codex can expose a real snapshot without reading `auth.json` directly;
- Claude can expose either a fixture-proven native snapshot or a clear `live quota unavailable`;
- no call path can redeem a reset credit;
- model-to-bucket mapping is never inferred from a name;
- JSON output is stable and covered by golden fixtures.

### 18.2 P0 — Context and instruction audit — Partially done (#94, #97)

#94 shipped `context`, effective Codex config/model/MCP inventory, instruction-byte accounting and
Codex-compatible AGENTS hierarchy discovery. #97 adds the focused `mcp` view plus explicit
root+subtree/monolithic hierarchy reporting. The session-boundary tranche adds a conservative
ccusage-backed most-recent-session signal and conditional new-session/compact advice without claiming
that the observed session is active. The MCP assessment tranche now identifies per-server exposure
hotspots and unusable/auth-broken servers while explicitly refusing removal advice when usage or
task-relevance evidence is absent. Safely attributable measured channels now expose raw-to-final before/after payload volume beside
their harness and tool family in `metrics`; independently measured channels are not summed across
families. Still open: total harness output for unobserved/unowned tool families, actual per-server
usage/task-relevance evidence required to recommend removal, and the native-deferral benchmark before
assigning Lazy MCP.

Add:

- `token-harness context`;
- `token-harness mcp`;
- project instruction byte accounting for `AGENTS.md` and `CLAUDE.md`;
- hierarchy diagnostics for monolithic instruction files;
- enabled MCP inventory and a measurable schema/context cost where the harness exposes it;
- tool-output volume by family;
- session-age/context signals where available;
- actionable recommendations for task-boundary clear/new-session/compact behavior.

Codex-specific work evaluates the native fields already present in the installed config schema,
including model/reasoning/verbosity profiles, project-doc byte limits, tool-output token limits and
tool/MCP deferral switches. Feature flags remain version-gated; their presence in one current schema
does not make them a permanent public contract.

Acceptance:

- the audit is read-only;
- a root + subtree instruction layout is recognized and not flattened;
- recommended removal of an MCP server includes evidence that it is unused or irrelevant to the
  current task;
- native Codex controls are benchmarked before Lazy MCP or a broad context provider is assigned the
  same surface.

### 18.3 P0 — Budget-aware recommendation engine — Partially done (#95)

#95 shipped deterministic advisory `optimize`, economy/balanced/quality/custom profiles, task
classes, reserve-aware five-hour/weekly pacing, context-first pressure, quality floors, native Codex
model catalog discovery, and effort recommendations restricted to levels the current model advertises.
It deliberately keeps the current model until benchmarked model-tier quality/quota evidence exists.
The history tranche adds a ccusage-backed local token-volume burn trend as workload evidence without converting it
to subscription quota. Still open: failed-attempt/escalation history and empirical model-tier
ranking.

Add `token-harness optimize` with profiles:

- `economy`;
- `balanced` (default);
- `quality`;
- `custom`.

The engine combines:

- observed five-hour and weekly headroom;
- time to reset and recent burn slope;
- a user reserve target;
- task class: mechanical, standard, hard, critical;
- context/instruction/MCP waste;
- benchmarked model-tier quality;
- failed-attempt/escalation history.

Initial output is advice, not mutation. Every recommendation names the evidence that caused it.

Examples:

- mechanical task + over-pace → economical native model tier, lower effort, low verbosity where
  supported;
- hard task + healthy weekly reserve → stronger model/effort instead of wasting allowance on
  repeated failed cheap attempts;
- any task + bloated context → fix context first, then consider model downgrade;
- under-used window close to reset → permit spending more headroom on hard work rather than ending
  the window with unused capacity.

Acceptance:

- the same snapshot + task description is deterministic;
- recommendations never select a model absent from the installed harness's discovered catalog;
- a quality floor can veto an economy recommendation;
- `unknown` quota produces context/model advice without pretending to know pacing.

### 18.4 P1 — Managed native policy — In progress

The transaction foundation now includes a first-class Codex `config/batchWrite` action. It delegates
TOML parsing/serialization to Codex app-server, targets the exact user `config.toml`, carries the
config version observed while planning, snapshots the file before mutation, treats
`configVersionConflict` as precondition drift, and participates in the existing byte-for-byte
verified rollback path. Context observation now also reads Codex's native config layer stack and
exposes the exact base user-config path plus its version as the only admissible managed write
target; selected user profiles remain user-owned and are deliberately not adopted. The same native
read now records effective origins for the Phase 18.4 policy fields (`model`,
`model_reasoning_effort`, and `model_verbosity`) and marks whether each currently comes from the
exact writable base-user layer. This prevents the later planner from confusing a project/profile
override with a setting it can safely own. The first reviewed policy path now connects the advisory
optimizer to that transaction: `token-harness plan --native-policy` may translate Codex
reasoning-effort and verbosity deltas into one atomic, versioned `config/batchWrite`. It admits
only fields whose origin metadata is present and either absent at that field or already matches the
exact base-user target; project and selected-profile overrides remain untouched. The stored plan can
then run through `apply --plan <id> --yes` with the existing rollback path. After
`config/batchWrite`, apply performs a native `config/read` and verifies every reviewed edit against
the effective configuration; a missing or mismatched postcondition fails the action and restores the
pre-write snapshot. Planning also refuses a field when the optimizer's current value no longer
matches the second native observation used to build the versioned write, preventing a recommendation
from being applied across an observation race. A persisted-plan integration fixture now covers the
full review/apply path and stale-version refusal. Optimizer-generated native batches are also marked
`subscription-safe`; the executor refuses such a batch before snapshot or process invocation if it
contains anything outside the current quota-safe write set (`model_reasoning_effort` and
`model_verbosity`). This makes the no-silent-pay-as-you-go acceptance criterion an executable
invariant rather than a planner convention: provider, auth, model, and service-tier changes require
a separately reviewed policy path. The transaction layer is nevertheless ready for that future
path: any reviewed top-level `model` edit must carry a native-catalog model reference, and apply
resolves it against the installed Codex `model/list` immediately before mutation. Missing,
truncated, or ambiguous catalogs stop before snapshot/write, and the resolved canonical `model`
value is the value verified after `config/batchWrite`. Model switching remains advisory until
model-tier quota benchmarks exist, so this resolver is infrastructure rather than an automatic
optimizer decision.

Only after 18.1–18.3 are stable, extend plan/apply/rollback to native configuration surfaces that can
be owned surgically.

Codex candidates:

- named profiles;
- model tier;
- reasoning effort;
- plan-mode reasoning effort;
- verbosity;
- instruction-byte budget;
- tool-output token budget;
- stable MCP/tool-deferral controls.

Claude candidates are admitted only from current, supported, reversible settings. Session commands
such as clear/compact stay user-driven unless Claude exposes a safe non-interactive lifecycle
contract.

Acceptance:

- user-owned profile entries remain user-owned;
- every managed field has absent/brownfield/drift/rollback fixtures;
- model IDs are resolved at apply time from the installed version;
- no managed setting silently enables pay-as-you-go API usage.

### 18.5 P1 — Historical telemetry with ccusage — Partially done

The history tranche adds `token-harness history` over an already installed fixture-gated ccusage 20.x. The reader
is forced offline and cost-free, keeps Claude/Codex daily and session token history separate from
live quota, and treats missing/incompatible ccusage as an ordinary explicit state. It now derives a
bounded most-recent-session candidate for advisory task-boundary hygiene, explicitly without
asserting that the candidate is the current session. Still open: project/task/receipt correlation,
Claude five-hour block history, and optional API-equivalent cost reporting kept in its own
measurement class.

Admit ccusage first as a read-only historical source, not as a live quota authority.

Use it to correlate:

- project/session/task;
- input, cached and output tokens where available;
- model usage;
- five-hour blocks/history;
- estimated API-equivalent cost;
- Token Harness task receipts.

Token Harness may later implement equivalent native readers, but should not duplicate a mature
parser merely to own it.

Acceptance:

- import is local/read-only;
- ccusage absence is non-fatal;
- estimated cost never appears as subscription spend;
- local history and live backend quota remain distinct measurement classes.

### 18.6 P1/P2 — Re-benchmark the provider stack

Re-score providers against the new KPI: useful work per observed quota delta.

Order:

1. RTK and HarnessTrim — retain active status on proven channels;
2. Lazy MCP — high priority, but only after comparison with native Codex tool deferral;
3. one of Context Mode / Headroom — broad context owner, never both by default;
4. Dejavu — repeated rerun loops;
5. repowise — only where retrieval payload is net-positive.

LLMLingua and Caveman do not block the milestone. Native compaction, verbosity and effort are tested
first.

Acceptance:

- benchmark fixtures include task success, not token count alone;
- provider marginal savings are still attributable by stage;
- backend quota deltas are reported separately from reducer token savings;
- a provider that saves tokens but increases retries can lose the comparison.

### 18.7 P2 — Cross-harness scheduler and compact handoff

Add a recommendation surface for choosing Claude Code or Codex for a new task based on:

- independently observed headroom;
- task class;
- benchmarked quality;
- current weekly reserve;
- expected handoff/context cost.

For in-progress work, generate a compact handoff containing objective, decisions, changed files,
validation state, unresolved questions and next action. Never copy the entire transcript as the
default handoff.

Acceptance:

- no background execution is required;
- the user sees why the other harness is recommended;
- a handoff has a configured size budget;
- switching is refused/recommended-against when transfer cost is larger than expected quota benefit.

### 18.8 P3 — Explicit paid overflow

Only after the included-quota path is optimized should Token Harness revisit:

- LiteLLM;
- Claude Code Router;
- RouteLLM;
- LLMRouter;
- vLLM Semantic Router.

These are classified as paid/external overflow or provider-cost policy, not as default quota-saving
providers.

Acceptance:

- API-key billing is visibly separate;
- prompt egress and credentials are diagnosed;
- a plan cannot cross from subscription auth to paid API billing implicitly;
- cost routing is reported in currency/credits, not merged into subscription-quota savings.

### 18.9 Quota-aware release gate

The quota-aware milestone is complete when a user can:

1. run `token-harness budget` and see verified Claude/Codex limit state or explicit unknowns;
2. run `token-harness context` and identify the largest avoidable context sources;
3. run `token-harness optimize` and receive an explainable economy/balanced/quality recommendation;
4. apply at least one reversible native policy on a covered harness/version;
5. see historical local usage beside live quota without the two being conflated;
6. compare at least three task classes with quality-gated baseline/optimized receipts;
7. generate a bounded cross-harness handoff;
8. use the default profile without any external model router or paid API path.

The headline claim for this milestone is intentionally narrow:

> Token Harness helps you get more successful coding work from Claude Code and Codex subscription
> limits by measuring live headroom, controlling avoidable context, and spending stronger
> model/effort choices only where they pay off.

It does **not** claim to bypass provider limits or to know an unpublished token-to-quota formula.

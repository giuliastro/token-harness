# RFC 0002: Provider contract

- Status: Accepted
- Date: 2026-07-29

## Purpose

A provider adapter translates one independently maintained optimization tool into
Token Harness's common lifecycle. Provider adapters describe and plan; the Token
Harness executor owns mutation.

This separation prevents every integration from inventing its own file writes,
process execution, backups, and error handling.

## Manifest

Every provider ships a versioned manifest with the following conceptual shape:

```ts
interface ProviderManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  description: string;
  homepage: string;
  sourceRepository: string;
  license: {
    spdx: string | null;
    distributionMode: "external" | "bundled";
    reviewRequired: boolean;
  };
  capabilities: CapabilityDeclaration[];
  platforms: PlatformSupport[];
  harnesses: HarnessSupport[];
  installationChannels: InstallationChannel[];
  metrics: MetricsDeclaration;
}
```

Provider IDs are lowercase, stable, and never reused. Display names can change.

## Adapter lifecycle

```ts
interface ProviderAdapter {
  readonly manifest: ProviderManifest;

  detect(context: DetectionContext): Promise<ProviderDetection>;
  inspect(context: InspectionContext): Promise<ProviderInspection>;
  plan(context: PlanningContext): Promise<ProviderPlan>;
  verify(context: VerificationContext): Promise<VerificationResult>;
  collectMetrics(context: MetricsContext): AsyncIterable<OptimizationEvent>;
}
```

There is deliberately no direct `install()` or `uninstall()` method. `plan()` returns
typed actions. The central executor applies or reverses them.

## Detection

Detection is read-only and reports evidence:

```ts
interface ProviderDetection {
  state: "absent" | "available" | "installed" | "configured" | "broken";
  version: string | null;
  executable: string | null;
  installationChannel: string | null;
  evidence: Evidence[];
  warnings: Diagnostic[];
}
```

Detection must not infer success solely from a configuration string. It should combine
evidence such as:

- executable resolution;
- `--version` output;
- package-manager inventory;
- expected hook/config presence;
- provider-native doctor output;
- a safe smoke test when available.

## Planning

A provider plan contains no executable closures and can be serialized as JSON:

```ts
interface ProviderPlan {
  providerId: string;
  desiredState: "configured" | "absent";
  actions: PlannedAction[];
  expectedCapabilities: ResolvedCapability[];
  diagnostics: Diagnostic[];
  verification: VerificationCheck[];
}
```

Supported action families begin with:

```ts
type PlannedAction =
  | DownloadArtifactAction
  | PackageManagerInstallAction
  | RunInstallerCommandAction
  | DelegatedProviderInstallAction
  | CreateDirectoryAction
  | WriteOwnedFileAction
  | MergeJsonAction
  | MergeTomlAction
  | MergeYamlAction
  | PatchMarkerBlockAction
  | RemoveOwnedChangeAction
  | RegisterMcpServerAction
  | RegisterHookAction;
```

### Delegated provider install

Some providers already own their harness integration and expose a correct installer.
HarnessTrim is the motivating case: `harnesstrim install claude --apply` writes the
configuration that HarnessTrim understands, and reimplementing those writes inside Token
Harness would duplicate the provider's adapter logic and violate the principle that
upstreams stay upstream.

`DelegatedProviderInstallAction` invokes the provider's own installer. Because Token
Harness did not compose the resulting edits, it cannot reverse them with an inverse
action, and it must not try.

The action therefore carries a mandatory declaration:

```ts
interface DelegatedProviderInstallAction {
  kind: "delegated-provider-install";
  id: string;
  executable: string;
  args: string[];
  /** Paths the installer is expected to create or modify. */
  affectedPaths: string[];
  /**
   * Directories within which all writes must fall. Fully content-snapshotted before the
   * invocation, so undeclared writes inside the boundary are both detected and
   * reversible.
   */
  containmentBoundary: string[];
  /** Rollback is restore-from-snapshot, never an inverse command. */
  rollbackStrategy: "restore-snapshot";
  /** True when the provider ships an uninstall command Token Harness may call. */
  upstreamUninstallAvailable: boolean;
}
```

Invariants:

1. The executor content-snapshots every file under `containmentBoundary` before invoking
   the installer, and records the absence of paths in `affectedPaths` that do not yet
   exist — absence is itself the snapshot.
2. After the invocation it re-scans the boundary. A file created or modified inside the
   boundary but outside `affectedPaths` fails the action and is named in the diagnostic.
3. Rollback restores the boundary to its snapshotted content and deletes files the scan
   shows as created. It never invents an uninstall command.
4. A boundary whose snapshot would exceed a declared size cap is rejected at planning
   time. The adapter must narrow the boundary rather than have the executor take a
   snapshot it cannot afford.
5. When `upstreamUninstallAvailable` is false, uninstall is restore-only and the plan
   says so before apply.

An earlier draft snapshotted only a *digest manifest* of the boundary. A digest detects
that an undeclared file changed but cannot restore its previous bytes, so invariant 3 was
unsatisfiable for exactly the case it was written to cover. Content snapshots are what
make detection and rollback the same guarantee, and the size cap is what keeps that
affordable — the boundaries in practice are small configuration directories.

### What this cannot detect

A child process can write anywhere it has permission to write. Token Harness observes
only what it scanned, so a write outside `containmentBoundary` is not detectable by this
mechanism — and an earlier draft of this RFC claimed otherwise, promising detection of
"a path outside `affectedPaths`" with no way to deliver it.

The boundary makes the guarantee bounded and true rather than unbounded and false:

- inside the boundary, undeclared writes are detected, fail the action, and are reversed;
- outside the boundary, they are neither detected nor reversible.

That limit is the reason delegated install is restricted rather than general. To qualify,
a provider must have a **reviewed write set**: its installer's writes are known from its
source, it writes configuration only, and the boundary covers them. The review is
recorded in the provider manifest with the upstream version it was performed against, and
it is redone when that version changes.

Full-filesystem monitoring would close the gap and is out of scope: it is
platform-specific, privileged on some systems, and disproportionate to the risk of an
audited first-party installer. The honest position is a narrow guarantee plus a named
precondition, not a broad guarantee that quietly fails.

Every action declares:

- a deterministic ID;
- risk class;
- whether network access is required;
- files and processes affected;
- preconditions;
- expected postconditions;
- rollback data requirements;
- a human-readable explanation.

## Process abstraction

Provider adapters never call the operating system directly. They receive a process
runner capable of:

- resolving binaries;
- invoking argument arrays without shell interpolation;
- capturing bounded stdout/stderr;
- enforcing timeouts;
- redacting declared sensitive values;
- returning structured exit information.

Tests use a fake runner. Shell strings are reserved for upstream commands that
strictly require a shell and must be marked as elevated risk.

## Installation channels

Channels are ordered by provider and platform. Examples:

- GitHub release asset with checksum;
- npm package;
- Homebrew formula;
- Cargo crate;
- uv tool or pipx package;
- provider-native plugin marketplace.

Token Harness never chooses `curl ... | sh` or `irm ... | iex` as its default
installation mechanism. If an upstream exposes only a script, Token Harness downloads
it as an artifact, records its digest, shows the source and intended invocation in the
plan, and requires explicit confirmation.

## Verification

Verification is capability-oriented:

```ts
interface VerificationResult {
  providerId: string;
  status: "healthy" | "degraded" | "failed" | "not-applicable";
  checks: Array<{
    id: string;
    status: "pass" | "warn" | "fail" | "info" | "not-exercised" | "skip";
    evidence: Evidence[];
    remediation?: string;
  }>;
}
```

The check-status union has been extended twice by observation rather than by design,
and both extensions are recorded here because the first was carried in code for two
phases while this document still contradicted it.

`info` was added because RFC 0006 §Golden path emits it — twice, for `tier-limit` and
`not-managed` — and RFC 0006 §Tier-aware verification status states outright that "the
tier limitation itself is reported as `info`". Dropping a status the normative transcript
uses would have made that transcript unrenderable, so Phase 1 implemented `info` and
reported the divergence against this section rather than resolving it silently.

`not-exercised` was added because RFC 0007 §Active and passive canaries needs it. A
passive canary reads the receipt of an operation the harness performed anyway; when no
such operation has happened yet, nothing is known. That is not a `pass` — asserting one
on no evidence is the failure this whole tier system exists to prevent — and it is not a
`fail`, because nothing has gone wrong. It is a third thing, and the honest report says
so. `not-exercised` never contributes to the problems-found exit code, for the same
reason `info` does not: a supported configuration that has simply not been used yet must
be able to exit 0.

Installing a binary is insufficient. The adapter must verify that the selected harness
actually reaches the provider at the intended hook or routing point.

### Verification tiers

Verification is the reason Token Harness exists rather than a shell script, so its
strength is declared, never implied. Every check belongs to one tier:

| Tier | Name | Evidence |
| --- | --- | --- |
| 1 | `presence` | The executable resolves and reports a version |
| 2 | `config-only` | The expected owned entry exists in the harness configuration |
| 3 | `canary` | A sentinel operation was observably intercepted by the provider |

Tier 3 is the target. The generic mechanism: Token Harness registers a sentinel whose
transformation is unambiguous, causes the harness to run an operation that must traverse
the interception point, and looks for the resulting receipt. If the receipt appears, the
pipeline is proven end to end.

Where a harness version makes tier 3 impossible, that is recorded per harness and per
capability in the compatibility matrix as `verification: config-only`, surfaced in
`verify` output as a warning, and published in the release's limitations table. It is
never silently downgraded, and a tier-2 result is never presented as proof of
interception.

The concrete sentinel mechanism for each harness is the subject of the Phase 2.5 spike,
whose result becomes RFC 0007. That spike precedes the provider adapters because its
outcome shapes the harness adapter contract.

## Metrics import

Providers expose metrics through one of:

- a machine-readable CLI command;
- a documented local database;
- JSON/JSONL files;
- structured hook events emitted by Token Harness;
- no importer, explicitly declared.

Importers are read-only. They store a provider-native cursor so repeated collection
does not duplicate events.

## Versioning

- Manifest schema uses an integer major version.
- Adapter changes remain backward compatible within a Token Harness minor release.
- Provider compatibility is expressed as tested version ranges.
- Unknown newer provider versions produce a warning and default to conservative
  behavior.
- Provider adapters may continue detection and metrics collection when installation
  support is temporarily blocked by upstream drift.

### Harness versioning is symmetric

The same discipline applies to harnesses. Harness configuration formats change with
upstream releases, often without announcement, and an assumption about a hook schema is
exactly as fragile as an assumption about a provider CLI.

Therefore every harness manifest declares tested version ranges, and:

- an unknown newer harness version produces a warning and conservative behavior;
- the harness version is recorded in every verification receipt;
- `status` compares the current harness version against the receipt and reports drift
  when it changed since apply, because a passing verification from before an upgrade is
  not evidence about the environment after it.

An earlier draft applied version ranges to providers only. That asymmetry was
unjustified and is removed.

### Providers may exceed the managed surface

A provider often supports harnesses that Token Harness does not manage. HarnessTrim
supports Hermes and Pi, which are outside the `0.1.0` harness set.

Rules:

- an unmanaged harness is reported as informational context, never as a problem;
- Token Harness never modifies or removes configuration for a harness it does not
  manage, even when the same provider owns it;
- uninstalling a provider integration affects only managed harnesses, and the plan says
  which integrations it is deliberately leaving in place.

## First-party provider requirements

RTK and HarnessTrim adapters must implement all lifecycle stages before the MVP is
declared complete:

- detection;
- installation planning;
- configuration planning;
- health verification;
- uninstall planning;
- metrics ingestion;
- Windows/macOS/Linux behavior;
- fixture-based tests.


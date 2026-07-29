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
    status: "pass" | "warn" | "fail" | "skip";
    evidence: Evidence[];
    remediation?: string;
  }>;
}
```

Installing a binary is insufficient. The adapter must verify that the selected harness
actually reaches the provider at the intended hook or routing point.

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


/**
 * Provider and harness manifests.
 *
 * `ProviderManifest` follows RFC 0002 §Manifest field for field. The member
 * types it names but does not define (`PlatformSupport`, `HarnessSupport`,
 * `InstallationChannel`, `MetricsDeclaration`) are defined here from the
 * properties the RFC states elsewhere; each carries the reference that
 * constrains it.
 */

import type { CapabilityDeclaration } from './capabilities.js';
import type { VerificationTier } from './detection.js';
import type { HarnessId, ProviderId } from './ids.js';
import type { OperatingSystem } from './platform.js';
import type { TestedVersionRange } from './version.js';

export const MANIFEST_SCHEMA_VERSION = 1;

export interface LicenseDeclaration {
  spdx: string | null;
  distributionMode: 'external' | 'bundled';
  reviewRequired: boolean;
}

/** RFC 0002 §First-party provider requirements: Windows/macOS/Linux behavior. */
export interface PlatformSupport {
  os: OperatingSystem;
  /** WSL is a distinct target from native Windows (PLAN §2.1). */
  wsl: boolean;
  supported: boolean;
  /** A stated limitation, not a defect. Null when there is none. */
  limitation: string | null;
}

/** RFC 0002 §Versioning and §Harness versioning is symmetric. */
export interface HarnessSupport {
  harness: HarnessId;
  testedVersions: TestedVersionRange;
  /** RFC 0002 §Verification tiers: recorded per harness, never implicit. */
  verificationTier: VerificationTier;
}

/** RFC 0002 §Installation channels and RFC 0004 §Network policy. */
export interface InstallationChannel {
  id: string;
  /**
   * What this channel calls the package, when that differs from the provider's own id.
   *
   * It usually does. RTK's winget id is `rtk-ai.rtk` — verified from the installed binary's path,
   * `WinGet/Packages/rtk-ai.rtk_.../rtk.exe`, and from `winget search rtk` — while its crate name
   * is plain `rtk`. One `packageName` on the action could only ever be right for one channel, so
   * the name belongs to the channel that uses it.
   */
  packageId?: string;
  kind: 'github-release' | 'npm' | 'homebrew' | 'cargo' | 'uv' | 'pipx' | 'harness-marketplace';
  /** Ordered per platform; lower sorts first. */
  priority: number;
  platforms: OperatingSystem[];
  requiresNetwork: boolean;
  requiresElevation: boolean;
  /** RFC 0004: an install script is an artifact with a digest, never a pipe to a shell. */
  digestAvailable: boolean;
}

/** RFC 0005 §Importers and §Importer degradation policy. */
export interface MetricsDeclaration {
  /** `none` is an explicit, supported declaration, not a gap. */
  source: 'cli-json' | 'jsonl' | 'local-database' | 'harness-events' | 'none';
  /** The fidelity mode the importer runs in; surfaced by `status`. */
  mode: 'native' | 'legacy' | 'unavailable';
  /** Default on-disk locations, when the source is file-based. */
  locations: string[];
}

/**
 * RFC 0002 §What this cannot detect: delegated install requires a reviewed write
 * set, "recorded in the provider manifest with the upstream version it was
 * performed against".
 */
export interface DelegatedInstallReview {
  upstreamVersion: string;
  reviewedWriteSet: string[];
  containmentBoundary: string[];
  upstreamUninstallAvailable: boolean;
}

export interface ProviderManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  id: ProviderId;
  displayName: string;
  description: string;
  homepage: string;
  sourceRepository: string;
  license: LicenseDeclaration;
  capabilities: CapabilityDeclaration[];
  platforms: PlatformSupport[];
  harnesses: HarnessSupport[];
  installationChannels: InstallationChannel[];
  metrics: MetricsDeclaration;
  delegatedInstallReview: DelegatedInstallReview | null;
}

/**
 * The harness-side manifest. RFC 0002 §Harness versioning is symmetric requires
 * tested ranges, unknown-newer warnings, and a declared verification tier for
 * harnesses on the same terms as providers; PLAN §3.1 lists the rest.
 */
/**
 * How a configuration file must be edited — RFC 0007 §The harness adapter contract,
 * declaration 1.
 *
 * Declared rather than inferred from the extension, because the extension lies. Claude
 * Code's `settings.json` is strict JSON and cannot hold a marker fence; OpenCode's
 * `opencode.jsonc` is named for comments and, on a real machine, was rejected by
 * `JSON.parse` for a trailing comma. Picking the parser from the file name would have
 * produced a destructive edit in both directions.
 */
export type HarnessConfigParser = 'json' | 'jsonc' | 'toml' | 'yaml' | 'markers';

export type HarnessConfigScope = 'user' | 'project';

export interface HarnessConfigFile {
  /**
   * Path relative to the home directory for a `user` scope, or to the project root for
   * a `project` scope. Never absolute: the adapter resolves it against the paths the
   * platform layer supplies.
   */
  path: string;
  scope: HarnessConfigScope;
  parser: HarnessConfigParser;
  /** The file `doctor` names when it reports the harness as detected. */
  primary: boolean;
}

/**
 * An interception point, in both spellings that matter.
 *
 * RFC 0003 addresses a capability scope with its own identifier (`pre-tool-use`); the
 * harness's configuration uses the harness's event name (`PreToolUse`). They are not
 * the same string and an adapter needs both — one to resolve ownership, one to write
 * the file.
 */
export interface HarnessInterceptionPoint {
  /** The segment used in a `<harness>/<tool-family>/<point>/<capability>` scope. */
  scopeId: string;
  /** The event name as the harness's own configuration spells it. */
  eventName: string;
}

/**
 * A family of tools whose execution can be intercepted — RFC 0007 §A tier is per
 * harness, per version, and per tool family.
 *
 * This exists because of a measured coverage hole rather than for symmetry. On the
 * Phase 2.5 spike machine a hook matching `Bash` did not see the identical command
 * routed through the harness's PowerShell tool, which is the default on Windows. A
 * matcher covering one family is a correctly installed and largely ineffective
 * integration, and nothing can report that without knowing the full list.
 */
export interface HarnessToolFamily {
  /** The matcher value the harness uses for this family. */
  id: string;
  /** Platforms on which the harness exposes it. */
  platforms: OperatingSystem[];
  /** True when the harness routes shell commands through it. */
  executesShellCommands: boolean;
}

/** RFC 0007 §What a receipt is. */
export type HarnessReceiptFamily =
  /** The harness emits a machine-readable stream naming what it ran. */
  | 'harness-event-stream'
  /** Only the provider's own records show that interception happened. */
  | 'provider-telemetry'
  /** Neither is available, which caps the harness below `canary`. */
  | 'none';

export interface HarnessManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  id: HarnessId;
  displayName: string;
  homepage: string;
  /**
   * The versions whose configuration schema has been observed.
   *
   * A harness whose verification tier changes across versions needs one manifest entry
   * per range, because `verificationTier` below is declared for *this* range. RFC 0007
   * requires the tier to be per version, and this pairing is how that is expressed.
   */
  testedVersions: TestedVersionRange;
  verificationTier: VerificationTier;
  /** The command that resolves and reports the version, for RFC 0002 §Detection evidence. */
  versionCommand: { executable: string; args: string[] } | null;
  interceptionPoints: HarnessInterceptionPoint[];
  configFiles: HarnessConfigFile[];
  toolFamilies: HarnessToolFamily[];
  /**
   * True when a declared interception point can be configured correctly and still not
   * run — RFC 0007 §Configuration presence is not evidence. Codex is the case: hook
   * enablement is persisted state, separate from the configuration and from trust.
   */
  requiresEnablement: boolean;
  /** Where that state lives, when it is required. Null otherwise. */
  enablementNote: string | null;
  receiptFamily: HarnessReceiptFamily;
}

/**
 * What a harness adapter tells a *provider* adapter about a configuration file.
 *
 * This is the seam between the two adapter families, so it lives in `core`:
 * `tests/integration/architecture.test.ts` forbids the harness and provider registries
 * from importing each other, and for a good reason — a provider that knew how to parse
 * `settings.json` would be a second implementation of the harness adapter, drifting from
 * the first.
 *
 * `commands` is the field that makes the seam work. A harness adapter reports the hook
 * command strings it found without interpreting them; a provider recognises *itself* in
 * that list. Neither has to know anything about the other.
 */
export interface HarnessConfigSummary {
  harnessId: HarnessId;
  configPath: string;
  scope: HarnessConfigScope;
  /** Interception points carrying entries, by `scopeId`. */
  interceptionPoints: string[];
  matchers: string[];
  /** Hook command strings, verbatim. Never parsed here. */
  commands: string[];
}

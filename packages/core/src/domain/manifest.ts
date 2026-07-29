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
export interface HarnessManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  id: HarnessId;
  displayName: string;
  homepage: string;
  testedVersions: TestedVersionRange;
  verificationTier: VerificationTier;
  /** Interception points the harness exposes, addressable in a capability scope. */
  interceptionPoints: string[];
  /** Scopes at which configuration is user-level rather than project-level. */
  userScopedConfigPaths: string[];
  projectScopedConfigPaths: string[];
}

/**
 * Detection results for providers and harnesses.
 *
 * `ProviderDetection` is verbatim from RFC 0002 §Detection. `HarnessDetection`
 * is its symmetric counterpart: RFC 0002 §Harness versioning is symmetric
 * requires harnesses to carry tested ranges, version drift, and unknown-newer
 * warnings exactly as providers do, and PLAN §3.1 lists the same lifecycle
 * stages for the harness contract.
 */

import type { Diagnostic } from './diagnostics.js';
import type { Evidence } from './evidence.js';
import type { HarnessId, ProviderId } from './ids.js';
import type { VersionVerdict } from './version.js';

export type ProviderState = 'absent' | 'available' | 'installed' | 'configured' | 'broken';

export interface ProviderDetection {
  providerId: ProviderId;
  state: ProviderState;
  version: string | null;
  executable: string | null;
  installationChannel: string | null;
  /** Verdict of `version` against the manifest's tested range. */
  versionVerdict: VersionVerdict | null;
  /**
   * Managed harnesses this provider is currently wired to. RFC 0002 §Providers
   * may exceed the managed surface: harnesses outside the managed set belong in
   * `unmanagedHarnessesConfigured` and are never a problem.
   */
  configuredHarnesses: HarnessId[];
  unmanagedHarnessesConfigured: HarnessId[];
  /**
   * True when the provider's manifest covers harnesses Token Harness does not
   * manage. It is why the doctor report says "not configured for any *managed*
   * harness" for HarnessTrim and "not configured for any harness" for RTK: the
   * qualifier is the honest scope of the claim, not a stylistic difference.
   */
  supportsUnmanagedHarnesses: boolean;
  /** RFC 0004 §Brownfield adoption: installed by the user, not by us. */
  managedByTokenHarness: boolean;
  /**
   * Whether Token Harness can bring an ownership assignment about for *this* installed build —
   * RFC 0003 §Resolution, "a capability the provider has but cannot be asked for is not an
   * assignable capability".
   *
   * The adapter answers it, for the reason `identifiesCommand` lives on the adapter too: only the
   * provider's own adapter knows what its installer can be asked for, and the answer depends on the
   * build in front of it rather than on the manifest. HarnessTrim is why it moved here (PLAN §15
   * item 46): at `0.0.5` no narrowed state was producible, and at `0.1.0` the installer grew the
   * flags that produce them. A constant list in the planner answered that question once, for every
   * version, and was wrong as soon as the installer changed underneath it.
   */
  /** Per harness, because that is the granularity the fact has. */
  assignableHarnesses: HarnessId[];
  evidence: Evidence[];
  warnings: Diagnostic[];
}

export type HarnessState = 'absent' | 'detected' | 'configured' | 'broken';

export interface HarnessDetection {
  harnessId: HarnessId;
  state: HarnessState;
  version: string | null;
  versionVerdict: VersionVerdict | null;
  /** Primary configuration file, when one was found. */
  configPath: string | null;
  /** RFC 0002 §Verification tiers — the strongest tier declared for this harness. */
  declaredVerificationTier: VerificationTier | null;
  evidence: Evidence[];
  warnings: Diagnostic[];
}

/** RFC 0002 §Verification tiers. */
export const VERIFICATION_TIERS = ['presence', 'config-only', 'canary'] as const;

export type VerificationTier = (typeof VERIFICATION_TIERS)[number];

export function verificationTierRank(tier: VerificationTier): number {
  return VERIFICATION_TIERS.indexOf(tier) + 1;
}

/**
 * RFC 0006 §Tier-aware verification status: a check is measured against what was
 * declared, not against the strongest tier that exists anywhere.
 */
export function meetsDeclaredTier(declared: VerificationTier, achieved: VerificationTier): boolean {
  return verificationTierRank(achieved) >= verificationTierRank(declared);
}

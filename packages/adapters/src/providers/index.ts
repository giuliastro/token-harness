/**
 * Provider adapter registry — PLAN §10.
 *
 * The contract lives in `contract.ts`; this file is only the list, so an adapter can
 * import the contract without importing the list it appears in.
 */

import type { ProviderId } from '@token-harness/core';

import { harnesstrimAdapter as baseHarnessTrimAdapter } from './harnesstrim.js';
import { rtkAdapter as baseRtkAdapter } from './rtk.js';
import type { ProviderAdapter } from './contract.js';
import { withProviderVersionCompatibility } from './version-compatibility.js';

export * from './contract.js';
export {
  observeGitNexusCandidate,
  parseGitNexusCliCapabilities,
  parseGitNexusVersion,
  type GitNexusCandidateObservation,
  type GitNexusCandidateState,
} from './gitnexus-candidate.js';
export {
  GITNEXUS_CLAUDE_MCP_POINTER,
  GITNEXUS_MCP_SERVER,
  GITNEXUS_REVIEWED_MCP_VERSION,
  planGitNexusManagedMcpActivation,
  planGitNexusManagedMcpRemoval,
  verifyGitNexusManagedMcpActivation,
  type GitNexusManagedMcpPlan,
  type GitNexusManagedMcpVerification,
  type GitNexusManagedMcpVerificationState,
} from './gitnexus-managed.js';
export {
  HEADROOM_MINIMUM_BENCHMARK_VERSION,
  HEADROOM_REVIEWED_BENCHMARK_VERSION,
  headroomVersionAtLeast,
  observeHeadroomCandidate,
  parseHeadroomVersion,
  parseHeadroomWrapTargets,
  type HeadroomCandidateObservation,
  type HeadroomCandidateState,
} from './headroom-candidate.js';
export {
  MCPTOON_MINIMUM_BENCHMARK_VERSION,
  mcptoonVersionAtLeast,
  observeMcptoonCandidate,
  parseMcptoonManifestCapabilities,
  parseMcptoonVersion,
  type McptoonCandidateObservation,
  type McptoonCandidateState,
} from './mcptoon-candidate.js';
export {
  MCPTOON_AGENT_INSTRUCTIONS,
  MCPTOON_CLAUDE_SKILL,
  MCPTOON_MANAGED_MINIMUM_VERSION,
  MCPTOON_REVIEWED_INSTALL_VERSION,
  MCPTOON_MARKER_BEGIN,
  MCPTOON_MARKER_END,
  planMcptoonManagedActivation,
  verifyMcptoonManagedActivation,
  type McptoonManagedActivationPlan,
  type McptoonManagedVerification,
  type McptoonManagedVerificationState,
} from './mcptoon-managed.js';
export { scopeProviderVerificationToHarness } from './harness-verification.js';
export { parseRtkAnalytics, harnessesWiredToRtk, rtkDatabasePath } from './rtk.js';
export {
  compareCapabilities,
  harnessesWiredToHarnessTrim,
  metricsLocations,
  synthesizeEventId,
  type HarnessTrimCapabilities,
  type HarnessTrimHarnessCapabilities,
} from './harnesstrim.js';
export {
  admitProviderPackageUpdate,
  applyProviderVersionCompatibility,
  reviewedProviderPackageMaximum,
  withProviderVersionCompatibility,
  type ProviderPackageUpdateAdmission,
} from './version-compatibility.js';

/**
 * Provider algorithms retain their fixture-backed historical baseline. This thin policy layer can
 * advance compatibility independently when a newer upstream contract has been reviewed.
 */
export const rtkAdapter = withProviderVersionCompatibility(baseRtkAdapter);

/**
 * HarnessTrim's supported package distribution is npm. Earlier builds declared `pnpm` because the
 * Token Harness workspace itself uses pnpm, but a global pnpm install depends on PNPM_HOME being
 * configured and failed on an otherwise healthy Windows machine. Keep the provider algorithm and
 * its historical evidence unchanged; only the package/update transport is normalized here.
 */
const harnesstrimWithSupportedPackageChannel: ProviderAdapter = {
  ...baseHarnessTrimAdapter,
  manifest: {
    ...baseHarnessTrimAdapter.manifest,
    installationChannels: [
      {
        id: 'npm',
        kind: 'npm',
        priority: 0,
        platforms: ['windows', 'macos', 'linux'],
        requiresNetwork: true,
        requiresElevation: false,
        digestAvailable: false,
      },
    ],
  },
};

export const harnesstrimAdapter = withProviderVersionCompatibility(
  harnesstrimWithSupportedPackageChannel,
);

/**
 * The public HarnessTrim adapter keeps its direct skills-only planning surface for focused callers
 * and adapter tests. The CLI registry is narrower: an ordinary multi-provider `plan` must not let
 * a non-intercepting optional skills install expand a plan from the harnesses HarnessTrim actually
 * owns.
 */
const cliHarnessTrimAdapter: ProviderAdapter = {
  ...harnesstrimAdapter,
  detect: async (context) => {
    const detection = await harnesstrimAdapter.detect(context);
    return {
      ...detection,
      harnesses: detection.harnesses.filter(
        (harness) => harness.enabled || harness.integration !== 'skills',
      ),
    };
  },
};

export const PROVIDER_ADAPTERS: Readonly<Record<ProviderId, ProviderAdapter>> = {
  rtk: rtkAdapter,
  harnesstrim: cliHarnessTrimAdapter,
};

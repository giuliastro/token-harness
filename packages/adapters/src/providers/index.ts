/**
 * Provider adapter registry — PLAN §10.
 *
 * The contract lives in `contract.ts`; this file is only the list, so an adapter can
 * import the contract without importing the list it appears in.
 */

import type { ProviderId } from '@token-harness/core';

import { harnesstrimAdapter as baseHarnessTrimAdapter } from './harnesstrim.js';
import { rtkAdapter as baseRtkAdapter } from './rtk.js';
import { gitnexusManagedProviderAdapter } from './gitnexus-provider.js';
import { headroomManagedProviderAdapter } from './headroom-provider.js';
import { mcptoonManagedProviderAdapter } from './mcptoon-provider.js';
import type { ProviderAdapter } from './contract.js';
import { withProviderVersionCompatibility } from './version-compatibility.js';

export * from './contract.js';
export {
  GITNEXUS_REVIEWED_BENCHMARK_VERSION,
  observeGitNexusCandidate,
  parseGitNexusCliCapabilities,
  parseGitNexusVersion,
  type GitNexusCandidateObservation,
  type GitNexusCandidateState,
} from './gitnexus-candidate.js';
export {
  GITNEXUS_CLAUDE_MCP_POINTER,
  GITNEXUS_CODEX_MARKER_BEGIN,
  GITNEXUS_CODEX_MARKER_END,
  GITNEXUS_CODEX_MCP_BODY,
  GITNEXUS_MCP_SERVER,
  GITNEXUS_REVIEWED_MCP_VERSION,
  gitnexusOwnedArtifact,
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
  HEADROOM_CLAUDE_MCP_POINTER,
  HEADROOM_CODEX_MARKER_BEGIN,
  HEADROOM_CODEX_MARKER_END,
  HEADROOM_CODEX_MCP_BODY,
  HEADROOM_MCP_SERVER,
  HEADROOM_REVIEWED_MCP_VERSION,
  headroomOwnedArtifact,
  planHeadroomManagedMcpActivation,
  verifyHeadroomManagedMcpActivation,
  type HeadroomManagedMcpPlan,
  type HeadroomManagedMcpVerification,
  type HeadroomManagedMcpVerificationState,
} from './headroom-managed.js';
export {
  MCPTOON_MINIMUM_BENCHMARK_VERSION,
  MCPTOON_REVIEWED_BENCHMARK_VERSION,
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
export { gitnexusAdapter, headroomAdapter, mcptoonAdapter } from './managed-optimization-tools.js';
export { gitnexusManagedProviderAdapter } from './gitnexus-provider.js';
export { headroomManagedProviderAdapter } from './headroom-provider.js';
export { mcptoonManagedProviderAdapter } from './mcptoon-provider.js';
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
 * owns to every supported harness on the machine.
 *
 * This is the distinction the Windows brownfield case exposed: RTK owns Claude while HarnessTrim
 * owns Codex, yet `plansWithoutOwnership: true` made HarnessTrim also propose Claude skills. The
 * compatibility gate then turned that optional side action into a global unsupported-environment
 * error. Registry planning therefore passes only owned harnesses and requires ownership. An
 * explicitly focused HarnessTrim plan still obtains ownership when it is the selected provider;
 * if it obtains none, the CLI correctly has no integration to mutate.
 */
const cliHarnessTrimAdapter: ProviderAdapter = {
  ...harnesstrimAdapter,
  plansWithoutOwnership: false,
  plan: (context, request) => {
    const ownedHarnesses = new Set(request.ownership.map((entry) => entry.scope.harness));
    return harnesstrimAdapter.plan(context, {
      ...request,
      harnesses: request.harnesses.filter((harness) => ownedHarnesses.has(harness.id)),
    });
  },
};

/**
 * First-class provider registry. RTK and HarnessTrim remain the production baseline. mcptoon,
 * GitNexus and Headroom now participate in the same ordinary managed lifecycle. Headroom manages
 * only the narrow local MCP registration surface: it does not start a proxy, index repositories,
 * install system prerequisites, or delegate broad persistent-install mutations to upstream.
 *
 * RTK stays first because the RFC 0003 compatibility rule gives it shell-output ownership where it
 * overlaps HarnessTrim. The additional providers claim no exclusive shell interception scope.
 */
const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [
  rtkAdapter,
  cliHarnessTrimAdapter,
  withProviderVersionCompatibility(mcptoonManagedProviderAdapter),
  withProviderVersionCompatibility(gitnexusManagedProviderAdapter),
  withProviderVersionCompatibility(headroomManagedProviderAdapter),
];

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return PROVIDER_ADAPTERS;
}

export function findProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}

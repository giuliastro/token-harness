import {
  MANIFEST_SCHEMA_VERSION,
  classifyVersion,
  diagnostic,
  harnessId,
  providerId,
  type HarnessId,
  type MetricsStore,
  type PlannedAction,
  type ProviderDetection,
  type ProviderManifest,
  type ProviderPlan,
} from '@token-harness/core';

import type {
  MetricsImport,
  ProviderAdapter,
  ProviderContext,
  ProviderPlanRequest,
  ProviderVerification,
} from './contract.js';
import { observeHeadroomCandidate } from './headroom-candidate.js';
import {
  HEADROOM_REVIEWED_MCP_VERSION,
  headroomOwnedArtifact,
  planHeadroomManagedMcpActivation,
  verifyHeadroomManagedMcpActivation,
} from './headroom-managed.js';

const HEADROOM = providerId('headroom');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

const HEADROOM_MANIFEST: ProviderManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: HEADROOM,
  displayName: 'Headroom',
  description:
    'Local MCP compression and retrieval tools for Claude Code and Codex, managed without starting a persistent proxy.',
  homepage: 'https://github.com/headroomlabs-ai/headroom',
  sourceRepository: 'https://github.com/headroomlabs-ai/headroom',
  license: { spdx: 'MIT', distributionMode: 'external', reviewRequired: false },
  capabilities: [],
  platforms: [
    { os: 'windows', wsl: false, supported: true, limitation: null },
    { os: 'macos', wsl: false, supported: true, limitation: null },
    { os: 'linux', wsl: false, supported: true, limitation: null },
  ],
  harnesses: [
    {
      harness: CLAUDE,
      testedVersions: { minimum: '2.1.269', maximum: '2.1.269' },
      verificationTier: 'config-only',
    },
    {
      harness: CODEX,
      testedVersions: { minimum: '0.153.0', maximum: '0.153.0' },
      verificationTier: 'config-only',
    },
  ],
  installationChannels: [
    {
      id: 'uv',
      packageId: 'headroom-ai[mcp]',
      kind: 'uv',
      priority: 0,
      platforms: ['windows', 'macos', 'linux'],
      requiresNetwork: true,
      requiresElevation: false,
      digestAvailable: false,
    },
  ],
  metrics: { source: 'none', mode: 'unavailable', locations: [] },
  delegatedInstallReviews: null,
};

function manualInstallWarning() {
  return diagnostic({
    severity: 'warning',
    code: 'headroom-uv-install-prerequisite',
    subject: 'headroom',
    message: `Headroom ${HEADROOM_REVIEWED_MCP_VERSION} is not installed. Token Harness can manage its MCP configuration after the reviewed CLI is present.`,
    remediation: `With your existing uv and Python 3.10+ installation, run: uv tool install --no-python-downloads --no-managed-python "headroom-ai[mcp]==${HEADROOM_REVIEWED_MCP_VERSION}". Token Harness does not install uv, Python, or admin prerequisites.`,
  });
}

async function detect(context: ProviderContext): Promise<ProviderDetection> {
  const observation = await observeHeadroomCandidate(context);
  const configuredHarnesses: HarnessId[] = [];
  if (observation.version === HEADROOM_REVIEWED_MCP_VERSION) {
    for (const harness of [CLAUDE, CODEX]) {
      const verification = await verifyHeadroomManagedMcpActivation(context, harness);
      if (verification.state === 'verified') configuredHarnesses.push(harness);
    }
  }

  const warnings = [];
  if (observation.state === 'absent') warnings.push(manualInstallWarning());
  if (observation.state === 'unsupported-version') {
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'headroom-provider-version-unreviewed',
        subject: 'headroom',
        message:
          observation.reasons[0] ??
          `The installed Headroom version is outside the reviewed ${HEADROOM_REVIEWED_MCP_VERSION} row.`,
        remediation: `Keep that installation user-owned or use the exact reviewed ${HEADROOM_REVIEWED_MCP_VERSION} build.`,
      }),
    );
  }

  return {
    providerId: HEADROOM,
    state:
      observation.state === 'absent'
        ? 'absent'
        : configuredHarnesses.length > 0
          ? 'configured'
          : 'installed',
    version: observation.version,
    executable: observation.executable,
    installationChannel: observation.state === 'absent' ? 'uv' : null,
    versionVerdict:
      observation.version === null
        ? null
        : classifyVersion(observation.version, {
            minimum: HEADROOM_REVIEWED_MCP_VERSION,
            maximum: HEADROOM_REVIEWED_MCP_VERSION,
          }),
    configuredHarnesses,
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses:
      observation.version === HEADROOM_REVIEWED_MCP_VERSION ? [CLAUDE, CODEX] : [],
    evidence: [],
    warnings,
  };
}

function removalAction(context: ProviderContext, harness: HarnessId): PlannedAction | null {
  const target = headroomOwnedArtifact(context, harness);
  if (target === null) return null;
  const path = target.path;
  return {
    kind: 'remove-owned-change',
    id: `headroom:${harness}:mcp-server:remove`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: ['The owned Headroom MCP integration still matches its transaction receipt'],
    postconditions: ['Only the Token Harness-owned Headroom MCP integration is removed'],
    rollbackData: 'file-snapshot',
    explanation: `Remove the exact Headroom ${harness} MCP integration owned by Token Harness`,
    path,
    reverses: `headroom:${harness}:mcp-server`,
    target,
  };
}

function dedupe(actions: readonly PlannedAction[]): PlannedAction[] {
  return [...new Map(actions.map((action) => [action.id, action])).values()];
}

async function plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan> {
  if (request.desiredState === 'absent') {
    const targets = request.harnesses
      .map((item) => item.id)
      .filter((id): id is HarnessId => id === CLAUDE || id === CODEX);
    return {
      providerId: HEADROOM,
      desiredState: 'absent',
      actions: dedupe(
        targets
          .map((harness) => removalAction(context, harness))
          .filter((action): action is PlannedAction => action !== null),
      ),
      targetHarnesses: targets,
    };
  }

  const actions: PlannedAction[] = [];
  const targetHarnesses: HarnessId[] = [];
  for (const harness of request.harnesses.map((item) => item.id)) {
    if (harness !== CLAUDE && harness !== CODEX) continue;
    const activation = await planHeadroomManagedMcpActivation(context, harness);
    if (activation.actions.length === 0) continue;
    actions.push(...activation.actions);
    targetHarnesses.push(harness);
  }
  return {
    providerId: HEADROOM,
    desiredState: 'configured',
    actions: dedupe(actions),
    targetHarnesses: [...new Set(targetHarnesses)],
  };
}

async function verify(context: ProviderContext): Promise<ProviderVerification> {
  const checks = [];
  let achieved: 'config-only' | 'presence' | null = null;
  for (const harness of [CLAUDE, CODEX]) {
    const result = await verifyHeadroomManagedMcpActivation(context, harness);
    if (result.state === 'verified') achieved = 'config-only';
    else if (achieved === null && result.state !== 'candidate-unavailable') achieved = 'presence';
    checks.push({
      id: `headroom-${harness}-managed-mcp`,
      status:
        result.state === 'verified'
          ? ('pass' as const)
          : result.state === 'not-configured'
            ? ('not-exercised' as const)
            : ('warn' as const),
      summary: result.detail,
      achievedTier:
        result.state === 'verified'
          ? ('config-only' as const)
          : result.state === 'candidate-unavailable'
            ? null
            : ('presence' as const),
      evidence: [],
      remediation:
        result.state === 'candidate-unavailable'
          ? `Install reviewed Headroom ${HEADROOM_REVIEWED_MCP_VERSION} with its MCP extra first.`
          : null,
    });
  }
  return {
    providerId: HEADROOM,
    declaredTier: 'config-only',
    achievedTier: achieved,
    receipt: null,
    checks,
    diagnostics: [],
  };
}

function unavailableMetrics(): MetricsImport {
  return {
    providerId: HEADROOM,
    mode: 'unavailable',
    source: null,
    imported: 0,
    skipped: 0,
    cursor: null,
    diagnostics: [],
  };
}

export const headroomManagedProviderAdapter: ProviderAdapter = {
  manifest: HEADROOM_MANIFEST,
  detect,
  identifiesCommand: (command) => /(^|[\\/\s"'])headroom(?:\.exe)?([\s"']|$)/i.test(command),
  verify,
  collectMetrics: async (_context: ProviderContext, _store: MetricsStore) => unavailableMetrics(),
  plan,
  plansWithoutOwnership: true,
};

import {
  MANIFEST_SCHEMA_VERSION,
  classifyVersion,
  diagnostic,
  harnessId,
  providerId,
  type HarnessId,
  type MetricsStore,
  type ProviderDetection,
  type ProviderManifest,
} from '@token-harness/core';

import type {
  MetricsImport,
  ProviderAdapter,
  ProviderContext,
  ProviderPlanRequest,
  ProviderVerification,
} from './contract.js';
import { GITNEXUS_REVIEWED_BENCHMARK_VERSION } from './gitnexus-candidate.js';
import {
  observeGitNexusManagedRuntime,
  planGitNexusManagedMcpActivation,
  verifyGitNexusManagedMcpActivation,
} from './gitnexus-managed.js';
import {
  HEADROOM_REVIEWED_BENCHMARK_VERSION,
  observeHeadroomCandidate,
} from './headroom-candidate.js';
import { MCPTOON_REVIEWED_BENCHMARK_VERSION } from './mcptoon-candidate.js';
import {
  observeMcptoonManagedRuntime,
  planMcptoonManagedActivation,
  verifyMcptoonManagedActivation,
} from './mcptoon-managed.js';

const MCPTOON = providerId('mcptoon');
const GITNEXUS = providerId('gitnexus');
const HEADROOM = providerId('headroom');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function platforms(): ProviderManifest['platforms'] {
  return [
    { os: 'windows', wsl: false, supported: true, limitation: null },
    { os: 'macos', wsl: false, supported: true, limitation: null },
    { os: 'linux', wsl: false, supported: true, limitation: null },
  ];
}

const MCPTOON_MANIFEST: ProviderManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: MCPTOON,
  displayName: 'mcptoon',
  description:
    'MCP discovery/schema compaction with reviewed agent guidance for Claude Code and Codex.',
  homepage: 'https://github.com/mcptoon/mcptoon',
  sourceRepository: 'https://github.com/mcptoon/mcptoon',
  license: { spdx: null, distributionMode: 'external', reviewRequired: false },
  capabilities: [],
  platforms: platforms(),
  harnesses: [
    {
      harness: CLAUDE,
      testedVersions: { minimum: '2.1.269', maximum: '2.1.269' },
      verificationTier: 'config-only',
    },
    {
      harness: CODEX,
      testedVersions: { minimum: '0.152.1', maximum: '0.153.0' },
      verificationTier: 'config-only',
    },
  ],
  installationChannels: [
    {
      id: 'pipx',
      packageId: 'mcptoon',
      kind: 'pipx',
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

const GITNEXUS_MANIFEST: ProviderManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: GITNEXUS,
  displayName: 'GitNexus',
  description:
    'Repository graph/code-intelligence provider with a reviewed Claude Code MCP registration.',
  homepage: 'https://github.com/abhigyanpatwari/GitNexus',
  sourceRepository: 'https://github.com/abhigyanpatwari/GitNexus',
  // PolyForm Noncommercial is intentionally not represented as an SPDX approval. Token Harness
  // can manage an external user installation without claiming commercial redistribution rights.
  license: { spdx: null, distributionMode: 'external', reviewRequired: true },
  capabilities: [],
  platforms: platforms(),
  harnesses: [
    {
      harness: CLAUDE,
      testedVersions: { minimum: '2.1.269', maximum: '2.1.269' },
      verificationTier: 'config-only',
    },
  ],
  installationChannels: [
    {
      id: 'npm',
      packageId: 'gitnexus',
      kind: 'npm',
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

const HEADROOM_MANIFEST: ProviderManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: HEADROOM,
  displayName: 'Headroom',
  description: 'Context-minimizing wrapper for Claude Code and Codex.',
  homepage: 'https://github.com/chopratejas/headroom',
  sourceRepository: 'https://github.com/chopratejas/headroom',
  license: { spdx: null, distributionMode: 'external', reviewRequired: false },
  capabilities: [],
  platforms: platforms(),
  harnesses: [],
  installationChannels: [
    {
      id: 'uv-python313',
      packageId: 'headroom',
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

function versionVerdict(version: string | null, reviewed: string) {
  return version === null
    ? null
    : classifyVersion(version, { minimum: reviewed, maximum: reviewed });
}

function warning(code: string, subject: string, message: string) {
  return diagnostic({
    severity: 'warning',
    code,
    subject,
    message,
    remediation: 'Use the exact reviewed version before asking Token Harness to change this tool.',
  });
}

function unavailableMetrics(provider: ReturnType<typeof providerId>): MetricsImport {
  return {
    providerId: provider,
    mode: 'unavailable',
    source: null,
    imported: 0,
    skipped: 0,
    cursor: null,
    diagnostics: [],
  };
}

async function mcptoonDetection(context: ProviderContext): Promise<ProviderDetection> {
  const observation = await observeMcptoonManagedRuntime(context);
  const configuredHarnesses: HarnessId[] = [];
  if (observation.ready) {
    for (const harness of [CLAUDE, CODEX]) {
      const verification = await verifyMcptoonManagedActivation(context, harness);
      if (verification.state === 'verified') configuredHarnesses.push(harness);
    }
  }
  const warnings =
    !observation.absent && !observation.ready
      ? [
          warning(
            'mcptoon-provider-capability-unavailable',
            'mcptoon',
            observation.detail,
          ),
        ]
      : [];
  return {
    providerId: MCPTOON,
    state:
      observation.absent
        ? 'absent'
        : configuredHarnesses.length > 0
          ? 'configured'
          : 'installed',
    version: observation.version,
    executable: observation.executable,
    installationChannel: observation.absent ? 'pipx' : null,
    versionVerdict: versionVerdict(observation.version, MCPTOON_REVIEWED_BENCHMARK_VERSION),
    configuredHarnesses,
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: observation.ready ? [CLAUDE, CODEX] : [],
    evidence: [],
    warnings,
  };
}

async function gitnexusDetection(context: ProviderContext): Promise<ProviderDetection> {
  const observation = await observeGitNexusManagedRuntime(context);
  const verification = observation.ready
    ? await verifyGitNexusManagedMcpActivation(context, CLAUDE)
    : null;
  const configuredHarnesses = verification?.state === 'verified' ? [CLAUDE] : [];
  const warnings =
    !observation.absent && !observation.ready
      ? [
          warning(
            'gitnexus-provider-capability-unavailable',
            'gitnexus',
            observation.detail,
          ),
        ]
      : [];
  return {
    providerId: GITNEXUS,
    state:
      observation.absent
        ? 'absent'
        : configuredHarnesses.length > 0
          ? 'configured'
          : 'installed',
    version: observation.version,
    executable: observation.executable,
    installationChannel: observation.absent ? 'npm' : null,
    versionVerdict: versionVerdict(observation.version, GITNEXUS_REVIEWED_BENCHMARK_VERSION),
    configuredHarnesses,
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: observation.ready ? [CLAUDE] : [],
    evidence: [],
    warnings,
  };
}

async function headroomDetection(context: ProviderContext): Promise<ProviderDetection> {
  const observation = await observeHeadroomCandidate(context);
  return {
    providerId: HEADROOM,
    state: observation.state === 'absent' ? 'absent' : 'installed',
    version: observation.version,
    executable: observation.executable,
    installationChannel: observation.state === 'absent' ? 'uv-python313' : null,
    versionVerdict: versionVerdict(observation.version, HEADROOM_REVIEWED_BENCHMARK_VERSION),
    configuredHarnesses: [],
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: [],
    evidence: [],
    warnings:
      observation.state === 'unsupported-version'
        ? [
            warning(
              'headroom-provider-version-unreviewed',
              'headroom',
              observation.reasons[0] ??
                'The installed Headroom version is outside the reviewed row.',
            ),
          ]
        : [],
  };
}

async function mcptoonVerify(context: ProviderContext): Promise<ProviderVerification> {
  const checks = [];
  let achieved: 'config-only' | 'presence' | null = null;
  for (const harness of [CLAUDE, CODEX]) {
    const result = await verifyMcptoonManagedActivation(context, harness);
    if (result.state === 'verified') achieved = 'config-only';
    else if (achieved === null && result.state !== 'candidate-unavailable') achieved = 'presence';
    checks.push({
      id: `mcptoon-${harness}-managed-guidance`,
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
      remediation: null,
    });
  }
  return {
    providerId: MCPTOON,
    declaredTier: 'config-only',
    achievedTier: achieved,
    receipt: null,
    checks,
    diagnostics: [],
  };
}

async function gitnexusVerify(context: ProviderContext): Promise<ProviderVerification> {
  const result = await verifyGitNexusManagedMcpActivation(context, CLAUDE);
  return {
    providerId: GITNEXUS,
    declaredTier: 'config-only',
    achievedTier:
      result.state === 'verified'
        ? 'config-only'
        : result.state === 'candidate-unavailable'
          ? null
          : 'presence',
    receipt: null,
    checks: [
      {
        id: 'gitnexus-claude-managed-mcp',
        status:
          result.state === 'verified'
            ? 'pass'
            : result.state === 'not-configured'
              ? 'not-exercised'
              : 'warn',
        summary: result.detail,
        achievedTier:
          result.state === 'verified'
            ? 'config-only'
            : result.state === 'candidate-unavailable'
              ? null
              : 'presence',
        evidence: [],
        remediation: null,
      },
    ],
    diagnostics: [],
  };
}

async function headroomVerify(context: ProviderContext): Promise<ProviderVerification> {
  const observation = await observeHeadroomCandidate(context);
  const ready = observation.state === 'benchmark-ready';
  const absent = observation.state === 'absent';
  return {
    providerId: HEADROOM,
    declaredTier: 'presence',
    achievedTier: ready ? 'presence' : null,
    receipt: null,
    checks: [
      {
        id: 'headroom-reviewed-wrapper',
        status: ready ? 'pass' : absent ? 'skip' : 'warn',
        summary:
          observation.reasons[0] ??
          (ready ? 'Headroom exposes the reviewed wrapper surface.' : 'Headroom is not ready.'),
        achievedTier: ready ? 'presence' : null,
        evidence: [],
        remediation: ready ? null : 'Install the exact reviewed Headroom build before using it.',
      },
    ],
    diagnostics: [],
  };
}

function dedupeActions<T extends { id: string }>(actions: readonly T[]): T[] {
  return [...new Map(actions.map((action) => [action.id, action])).values()];
}

async function mcptoonPlan(context: ProviderContext, request: ProviderPlanRequest) {
  if (request.desiredState === 'absent') {
    return {
      providerId: MCPTOON,
      desiredState: 'absent' as const,
      actions: [],
      targetHarnesses: [],
    };
  }
  const actions = [];
  const targets: HarnessId[] = [];
  for (const harness of request.harnesses.map((item) => item.id)) {
    if (harness !== CLAUDE && harness !== CODEX) continue;
    const plan = await planMcptoonManagedActivation(context, harness);
    if (plan.actions.length === 0) continue;
    actions.push(...plan.actions);
    targets.push(harness);
  }
  return {
    providerId: MCPTOON,
    desiredState: 'configured' as const,
    actions: dedupeActions(actions),
    targetHarnesses: [...new Set(targets)],
  };
}

async function gitnexusPlan(context: ProviderContext, request: ProviderPlanRequest) {
  if (request.desiredState === 'absent') {
    return {
      providerId: GITNEXUS,
      desiredState: 'absent' as const,
      actions: [],
      targetHarnesses: [],
    };
  }
  const claude = request.harnesses.find((item) => item.id === CLAUDE);
  if (claude === undefined) {
    return {
      providerId: GITNEXUS,
      desiredState: 'configured' as const,
      actions: [],
      targetHarnesses: [],
    };
  }
  const plan = await planGitNexusManagedMcpActivation(context, CLAUDE);
  return {
    providerId: GITNEXUS,
    desiredState: 'configured' as const,
    actions: plan.actions,
    targetHarnesses: plan.actions.length === 0 ? [] : [CLAUDE],
  };
}

async function headroomPlan(_context: ProviderContext, request: ProviderPlanRequest) {
  return {
    providerId: HEADROOM,
    desiredState: request.desiredState,
    actions: [],
    targetHarnesses: [],
  };
}

export const mcptoonAdapter: ProviderAdapter = {
  manifest: MCPTOON_MANIFEST,
  detect: mcptoonDetection,
  identifiesCommand: (command) => /(^|[\\/\s"'])mcptoon(?:\.exe)?([\s"']|$)/i.test(command),
  verify: mcptoonVerify,
  collectMetrics: async (_context: ProviderContext, _store: MetricsStore) =>
    unavailableMetrics(MCPTOON),
  plan: mcptoonPlan,
  plansWithoutOwnership: true,
};

export const gitnexusAdapter: ProviderAdapter = {
  manifest: GITNEXUS_MANIFEST,
  detect: gitnexusDetection,
  identifiesCommand: (command) => /(^|[\\/\s"'])gitnexus(?:\.cmd|\.exe)?([\s"']|$)/i.test(command),
  verify: gitnexusVerify,
  collectMetrics: async (_context: ProviderContext, _store: MetricsStore) =>
    unavailableMetrics(GITNEXUS),
  plan: gitnexusPlan,
  plansWithoutOwnership: true,
};

export const headroomAdapter: ProviderAdapter = {
  manifest: HEADROOM_MANIFEST,
  detect: headroomDetection,
  identifiesCommand: (command) => /(^|[\\/\s"'])headroom(?:\.exe)?([\s"']|$)/i.test(command),
  verify: headroomVerify,
  collectMetrics: async (_context: ProviderContext, _store: MetricsStore) =>
    unavailableMetrics(HEADROOM),
  plan: headroomPlan,
};

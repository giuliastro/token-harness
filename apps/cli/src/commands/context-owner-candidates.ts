import {
  observeHeadroomCandidate,
  observeMcptoonCandidate,
  type ProviderContext,
} from '@token-harness/adapters';
import {
  diagnostic,
  type Diagnostic,
  type OptimizationCandidateObservation,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export interface ContextOptimizationCandidateSnapshot {
  candidates: OptimizationCandidateObservation[];
  diagnostics: Diagnostic[];
}

function providerContext(context: CommandContext): ProviderContext | null {
  if (context.adapters === null) return null;
  return {
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
    harnessConfigs: [],
    now: context.now,
    localDatabase: context.adapters.localDatabase,
    projectIdFor: context.adapters.projectIdFor,
  };
}

function headroomDiagnostics(
  observation: Awaited<ReturnType<typeof observeHeadroomCandidate>>,
): Diagnostic[] {
  const version = observation.version === null ? '' : ` ${observation.version}`;
  const baseline = observation.minimumBenchmarkVersion;
  const reason = observation.reasons[0] ?? 'Keep the candidate disabled until it is proven safe';

  if (observation.state === 'absent') {
    return [
      diagnostic({
        severity: 'info',
        code: 'context-owner-candidate-absent',
        subject: 'headroom',
        message: 'Headroom is not installed; its context-owner candidate is inactive',
        remediation: 'No action is required; Token Harness never installs it silently',
      }),
    ];
  }

  if (observation.state === 'unsupported-version') {
    return [
      diagnostic({
        severity: 'warning',
        code: 'context-owner-candidate-version',
        subject: 'headroom',
        message: `Headroom${version} is below benchmark baseline ${baseline}`,
        remediation: 'Keep this candidate disabled on the installed version',
      }),
    ];
  }

  if (observation.state === 'installed') {
    return [
      diagnostic({
        severity: 'info',
        code: 'context-owner-candidate-installed',
        subject: 'headroom',
        message: `Headroom${version} is installed but is not benchmark-ready`,
        remediation: reason,
      }),
    ];
  }

  return [
    diagnostic({
      severity: 'info',
      code: 'context-owner-candidate-ready',
      subject: 'headroom',
      message: `Headroom${version} is ready for paired benchmarking and remains disabled`,
      remediation: 'Collect three quality-safe pairs before experimental admission',
    }),
  ];
}

function mcptoonDiagnostics(
  observation: Awaited<ReturnType<typeof observeMcptoonCandidate>>,
): Diagnostic[] {
  const version = observation.version === null ? '' : ` ${observation.version}`;
  const baseline = observation.minimumBenchmarkVersion;
  const reason =
    observation.reasons[0] ?? 'Keep mcptoon disabled until benchmark evidence is available';

  if (observation.state === 'absent') {
    return [
      diagnostic({
        severity: 'info',
        code: 'context-optimizer-mcptoon-absent',
        subject: 'mcptoon',
        message: 'mcptoon is not installed; MCP schema reduction is not being evaluated',
        remediation: 'No action is required; Token Harness never installs mcptoon silently',
      }),
    ];
  }

  if (observation.state === 'unsupported-version') {
    return [
      diagnostic({
        severity: 'warning',
        code: 'context-optimizer-mcptoon-version',
        subject: 'mcptoon',
        message: `mcptoon${version} is below benchmark baseline ${baseline}`,
        remediation: 'Keep this candidate disabled on the installed version',
      }),
    ];
  }

  if (observation.state === 'installed') {
    return [
      diagnostic({
        severity: 'info',
        code: 'context-optimizer-mcptoon-installed',
        subject: 'mcptoon',
        message: `mcptoon${version} is installed but is not benchmark-ready`,
        remediation: reason,
      }),
    ];
  }

  return [
    diagnostic({
      severity: 'info',
      code: 'context-optimizer-mcptoon-ready',
      subject: 'mcptoon',
      message: `mcptoon${version} can be benchmarked for MCP discovery savings and remains disabled`,
      remediation:
        'Measure native versus compact MCP context, then collect paired quality evidence before activation',
    }),
  ];
}

/** Run each read-only candidate observer once and expose a bounded typed product projection. */
export async function observeContextOptimizationCandidates(
  context: CommandContext,
): Promise<ContextOptimizationCandidateSnapshot> {
  const provider = providerContext(context);
  if (provider === null) return { candidates: [], diagnostics: [] };
  const [headroom, mcptoon] = await Promise.all([
    observeHeadroomCandidate(provider),
    observeMcptoonCandidate(provider),
  ]);
  return {
    candidates: [
      {
        id: 'headroom',
        displayName: 'Headroom',
        category: 'context-minimization',
        state: headroom.state,
        version: headroom.version,
        minimumBenchmarkVersion: headroom.minimumBenchmarkVersion,
      },
      {
        id: 'mcptoon',
        displayName: 'mcptoon',
        category: 'mcp-discovery',
        state: mcptoon.state,
        version: mcptoon.version,
        minimumBenchmarkVersion: mcptoon.minimumBenchmarkVersion,
      },
    ],
    diagnostics: [...headroomDiagnostics(headroom), ...mcptoonDiagnostics(mcptoon)],
  };
}

/** Historical helper retained for callers that only need diagnostics. */
export async function contextOwnerCandidateDiagnostics(
  context: CommandContext,
): Promise<Diagnostic[]> {
  return (await observeContextOptimizationCandidates(context)).diagnostics;
}

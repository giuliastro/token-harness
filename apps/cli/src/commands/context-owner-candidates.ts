import { observeHeadroomCandidate } from '@token-harness/adapters';
import { diagnostic, type Diagnostic } from '@token-harness/core';

import type { CommandContext } from './context.js';

export async function contextOwnerCandidateDiagnostics(
  context: CommandContext,
): Promise<Diagnostic[]> {
  if (context.adapters === null) return [];

  const observation = await observeHeadroomCandidate({
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
    harnessConfigs: [],
    now: context.now,
    localDatabase: context.adapters.localDatabase,
    projectIdFor: context.adapters.projectIdFor,
  });
  const version = observation.version === null ? '' : ` ${observation.version}`;

  if (observation.state === 'absent') {
    return [
      diagnostic({
        severity: 'info',
        code: 'context-owner-candidate-absent',
        subject: 'headroom',
        message: 'Headroom is not installed; its context-owner candidate is inactive',
        remediation:
          'No action is required; Token Harness never installs this candidate silently',
      }),
    ];
  }

  if (observation.state === 'unsupported-version') {
    return [
      diagnostic({
        severity: 'warning',
        code: 'context-owner-candidate-version',
        subject: 'headroom',
        message:
          `Headroom${version} predates benchmark baseline ` +
          observation.minimumBenchmarkVersion,
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
        remediation:
          observation.reasons[0] ?? 'Keep the candidate disabled until readiness is proven',
      }),
    ];
  }

  return [
    diagnostic({
      severity: 'info',
      code: 'context-owner-candidate-ready',
      subject: 'headroom',
      message: `Headroom${version} is ready for paired benchmarking and remains disabled`,
      remediation:
        'Collect three recent quality-safe pairs before RFC 0026 experimental admission',
    }),
  ];
}

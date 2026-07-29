/**
 * `token-harness doctor`.
 *
 * The harness and provider registries are empty at Phase 1, and this command is
 * written so that fact changes nothing about the contract: the report shape, the
 * exit code, and the stream discipline are the same whether the registries hold
 * zero adapters or five.
 */

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES,
  commandResult,
  type CommandResult,
  type DoctorReport,
  type HarnessDetection,
  type ProviderDetection,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

function isBroken(detection: HarnessDetection | ProviderDetection): boolean {
  return detection.state === 'broken';
}

export async function runDoctor(context: CommandContext): Promise<CommandResult<DoctorReport>> {
  const detectionContext = { projectRoot: context.projectRoot };

  const harnesses = await Promise.all(
    listHarnessAdapters()
      .filter((adapter) => context.harness === null || adapter.manifest.id === context.harness)
      .map((adapter) => adapter.detect(detectionContext)),
  );
  const providers = await Promise.all(
    listProviderAdapters()
      .filter((adapter) => context.provider === null || adapter.manifest.id === context.provider)
      .map((adapter) => adapter.detect(detectionContext)),
  );

  // RFC 0006 §Exit codes: exit 3 means "a broken integration, an unowned edit on
  // an exclusive surface, a version outside a tested range, or a verification
  // result below its declared tier". An installed-but-unwired provider is none
  // of those, so it does not count here.
  const problemCount =
    harnesses.filter(isBroken).length +
    providers.filter(isBroken).length +
    [...harnesses, ...providers].filter((detection) => detection.versionVerdict === 'unknown-newer')
      .length;

  const report: DoctorReport = {
    platform: context.platform,
    harnesses,
    providers,
    problemCount,
  };

  return commandResult<DoctorReport>({
    command: 'doctor',
    exitCode: problemCount === 0 ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
    data: report,
  });
}

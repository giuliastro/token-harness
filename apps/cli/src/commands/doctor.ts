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
  COMPATIBILITY_ROWS,
  EXIT_CODES,
  admitManagedMutation,
  commandResult,
  diagnostic,
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
  const detectionContext =
    context.adapters === null
      ? null
      : {
          fs: context.adapters.fs,
          runner: context.adapters.runner,
          facts: context.platform,
          paths: context.adapters.paths,
          projectRoot: context.projectRoot,
        };

  // No adapter access means no detection. Reporting an empty list is honest — nothing
  // was inspected — and inventing a result from the registry alone would be the
  // config-only mistake RFC 0007 exists to name.
  const adapters =
    detectionContext === null
      ? []
      : listHarnessAdapters().filter(
          (adapter) => context.harness === null || adapter.manifest.id === context.harness,
        );

  const harnesses =
    detectionContext === null
      ? []
      : await Promise.all(adapters.map((adapter) => adapter.detect(detectionContext)));

  /**
   * `doctor` inspects as well as detects.
   *
   * Detection answers "is this harness here"; inspection answers "does its integration
   * actually cover this machine". RFC 0007 §A tier is per harness, per version, and per
   * tool family exists because a hook matching one tool family leaves another entirely
   * bypassed, and a report that found the harness and stayed silent about that would be
   * the most useful thing the Phase 2.5 spike learned, kept to itself.
   *
   * Inspection is read-only, so this keeps `doctor` within RFC 0004 §Command behavior.
   */
  const inspections =
    detectionContext === null
      ? []
      : await Promise.all(adapters.map((adapter) => adapter.inspect(detectionContext)));
  const inspectionDiagnostics = inspections.flatMap((inspection) => inspection.diagnostics);

  /**
   * The seam between the two adapter families, assembled here.
   *
   * `tests/integration/architecture.test.ts` forbids the harness and provider registries
   * from importing each other, so neither can reach the other's findings. This command
   * can, and it is the only place that should: the harness adapters report what is
   * configured, and a provider recognises itself in that report.
   */
  const harnessConfigs = inspections.flatMap((inspection) => inspection.summaries);
  const providers =
    detectionContext === null
      ? []
      : await Promise.all(
          listProviderAdapters()
            .filter(
              (adapter) => context.provider === null || adapter.manifest.id === context.provider,
            )
            .map((adapter) =>
              adapter.detect({
                ...detectionContext,
                harnessConfigs,
                now: context.now,
                localDatabase: context.adapters?.localDatabase ?? null,
                projectIdFor: context.adapters?.projectIdFor ?? (() => 'p_unattributed'),
              }),
            ),
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

  /**
   * RFC 0009 §Compatibility matrix — no-row combinations are reported, not counted.
   *
   * A provider/harness/version combination with no row is not a broken integration: the
   * environment is fine, and the user may configure it by hand. It is why `plan` will refuse
   * managed mutation, and `doctor` naming it here — on the provider's own detection, where the
   * reader is already looking at that provider — is how the refusal stops being a surprise.
   * It is a warning, not a problem, so it leaves the exit code alone.
   */
  const rows = context.compatibilityRows ?? COMPATIBILITY_ROWS;
  const providersWithCoverage = providers.map((detection) => {
    if (detection.state !== 'configured' || detection.configuredHarnesses.length === 0) {
      return detection;
    }
    const uncovered = detection.configuredHarnesses.flatMap((harness) => {
      const harnessVersion =
        harnesses.find((candidate) => candidate.harnessId === harness)?.version ?? null;
      const admission = admitManagedMutation(rows, {
        provider: detection.providerId,
        providerVersion: detection.version,
        harness,
        harnessVersion,
        os: context.platform.os,
        wsl: context.platform.isWsl,
      });
      if (admission.state === 'admitted') return [];
      return [
        diagnostic({
          severity: 'warning',
          code: 'no-compatibility-row',
          message:
            `no compatibility row covers ${detection.providerId} on ${harness}` +
            `${detection.version !== null ? ` at ${detection.version}` : ''} — ` +
            `${admission.missing}`,
          remediation:
            'Add a compatibility row whose fixture proves this combination, or configure this integration by hand',
        }),
      ];
    });
    if (uncovered.length === 0) return detection;
    return { ...detection, warnings: [...detection.warnings, ...uncovered] };
  });

  const report: DoctorReport = {
    platform: context.platform,
    harnesses,
    providers: providersWithCoverage,
    problemCount,
  };

  return commandResult<DoctorReport>({
    command: 'doctor',
    exitCode: problemCount === 0 ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
    data: report,
    // Detection warnings are already inside each detection object and rendered with it.
    // Inspection has no row in the report, so its diagnostics travel here: on stderr in
    // human mode, inside the envelope under `--json`, per RFC 0006 §Streams.
    diagnostics: inspectionDiagnostics,
  });
}

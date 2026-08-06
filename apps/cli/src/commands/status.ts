/**
 * `token-harness status`.
 *
 * Two jobs, and only one of them needs a receipt.
 *
 * Reporting applied pipelines does: RFC 0004 §Post-apply drift compares a receipt against the
 * live environment, and there is no `apply` yet, so `pipelines` stays empty and honest.
 *
 * Conflict detection does not. RFC 0003 §Continuous conflict detection exists precisely because
 * "every harness in scope runs all matching hooks rather than only the first" — so an unowned
 * entry on an exclusive scope is a real, present-tense conflict whether or not Token Harness
 * installed anything. Waiting for a receipt to report it would mean the one machine that cannot
 * be warned is the machine where the user wired everything by hand.
 *
 * So ownership is resolved live and compared against what the harness adapters found on disk.
 * When `apply` lands, the receipt becomes a second source for the same comparison rather than
 * the first.
 */

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import {
  COMPATIBILITY_RULES,
  EXIT_CODES,
  commandResult,
  detectUnownedEntries,
  resolveOwnership,
  toReportedDrift,
  type CommandResult,
  type HarnessConfigSummary,
  type HarnessManifest,
  type ProviderId,
  type ResolverProvider,
  type StatusReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export async function runStatus(context: CommandContext): Promise<CommandResult<StatusReport>> {
  const report: StatusReport = {
    platform: context.platform,
    // RFC 0004 §Post-apply drift: a pipeline is something a receipt records, and there are no
    // receipts until `apply` exists. Reporting resolved ownership here as though it had been
    // applied would be the one claim `status` must never make.
    pipelines: [],
    drift: [],
    importers: [],
    problemCount: 0,
  };

  if (context.adapters === null) {
    return commandResult<StatusReport>({
      command: 'status',
      exitCode: EXIT_CODES.ok,
      data: report,
    });
  }

  const detectionContext = {
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
  };

  const harnessAdapters = listHarnessAdapters().filter(
    (adapter) => context.harness === null || adapter.manifest.id === context.harness,
  );

  const present: HarnessManifest[] = [];
  const configs: HarnessConfigSummary[] = [];
  for (const adapter of harnessAdapters) {
    const detection = await adapter.detect(detectionContext);
    if (detection.state === 'absent') continue;
    present.push(adapter.manifest);
    const inspection = await adapter.inspect(detectionContext);
    configs.push(...inspection.summaries);
  }

  const providerAdapters = listProviderAdapters();

  /**
   * `status` probes provider versions because the resolution it already performs now depends on
   * them — RFC 0004 §Amended: a compatibility rule speaks only for the versions it records.
   *
   * It would have been cheaper to pass nothing and let the rules stand. That is exactly the
   * loophole `observedVersions` is required for: a read-only command reporting ownership computed
   * from a rule of unknown validity would be reporting a conclusion it cannot support.
   */
  const observedVersions: Record<string, string | null> = {};
  const providers: ResolverProvider[] = [];
  for (const adapter of providerAdapters) {
    const detection = await adapter.detect({
      ...detectionContext,
      harnessConfigs: configs,
      now: context.now,
      localDatabase: context.adapters.localDatabase,
      projectIdFor: context.adapters.projectIdFor,
    });
    observedVersions[adapter.manifest.id] = detection.version;
    // Same probe, two answers: the version the rules are checked against, and whether this build
    // can be asked for the state a rule would assign. `plan.ts` says why the second is not a
    // constant, and `status` must resolve identically or it reports a different tool's conclusion.
    providers.push({
      id: adapter.manifest.id,
      capabilities: adapter.manifest.capabilities,
      assignable: detection.assignable,
    });
  }

  const resolution = resolveOwnership({
    profile: 'safe',
    harnesses: present,
    providers,
    rules: [...COMPATIBILITY_RULES],
    observedVersions,
    harness: context.harness,
  });

  /**
   * Recognising a command as a provider's own.
   *
   * Delegated to the provider adapters, the same seam RFC 0002 uses for detection: a provider
   * recognises itself in a hook command without anyone here parsing a configuration file.
   * Deciding it in this module would be a second implementation of every provider's identity,
   * free to drift from the first.
   */
  const identify = (command: string): ProviderId | null => {
    for (const adapter of providerAdapters) {
      if (adapter.identifiesCommand(command)) return adapter.manifest.id;
    }
    return null;
  };

  const findings = detectUnownedEntries({ ownership: resolution.ownership, configs, identify });
  report.drift = findings.map(toReportedDrift);

  // RFC 0003: "the finding is actionable, so the command exits with the problems-found code
  // from RFC 0006".
  report.problemCount = report.drift.length;

  return commandResult<StatusReport>({
    command: 'status',
    exitCode: report.problemCount === 0 ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
    data: report,
  });
}

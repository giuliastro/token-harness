/**
 * `token-harness status`.
 *
 * Two jobs, and only one of them needs a receipt.
 *
 * Reporting applied pipelines needs both sides of the claim: the committed receipt says what Token
 * Harness applied, and live provider detection says whether that integration is still configured.
 * A historical journal alone is not enough — after uninstall it remains history and must not become
 * a ghost pipeline in status.
 *
 * Conflict detection can also run without a receipt. RFC 0003 §Continuous conflict detection exists precisely because
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
  FileJournalStore,
  TOKEN_HARNESS_OWNER,
  commandResult,
  detectUnownedEntries,
  resolveOwnership,
  toReportedDrift,
  type CommandResult,
  type HarnessConfigSummary,
  type HarnessManifest,
  type ProviderDetection,
  type ProviderId,
  type ResolverProvider,
  type StatusReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export async function runStatus(context: CommandContext): Promise<CommandResult<StatusReport>> {
  const report: StatusReport = {
    platform: context.platform,
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
  const providerDetections = new Map<ProviderId, ProviderDetection>();
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
    providerDetections.set(adapter.manifest.id, detection);
    // Same probe, two answers: the version the rules are checked against, and whether this build
    // can be asked for the state a rule would assign. `plan.ts` says why the second is not a
    // constant, and `status` must resolve identically or it reports a different tool's conclusion.
    providers.push({
      id: adapter.manifest.id,
      capabilities: adapter.manifest.capabilities,
      assignableHarnesses: new Set(detection.assignableHarnesses),
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
   * Applied pipeline state comes from committed journals, never from "what the resolver would do
   * now". The second test is live: every recorded owner for a harness must still report itself
   * configured there. That makes an uninstall disappear from status without deleting history.
   *
   * Newest journal wins per harness. Older schema-1 journals without `appliedPipeline` stay
   * readable but cannot support this stronger claim, so they are skipped rather than guessed.
   */
  if (context.stateRoot !== null) {
    const journalRoot = context.adapters.fs.join(context.stateRoot, 'journals');
    if ((await context.adapters.fs.stat(journalRoot)) !== null) {
      const journals = new FileJournalStore({
        fs: context.adapters.fs,
        journalRoot,
        backupRoot: context.adapters.fs.join(context.stateRoot, 'backups'),
      });
      const reportedHarnesses = new Set<string>();

      for (const journal of await journals.list()) {
        if (journal.outcome !== 'committed' || journal.appliedPipeline === undefined) continue;

        const byHarness = new Map<string, typeof journal.appliedPipeline.owners>();
        for (const owner of journal.appliedPipeline.owners) {
          const current = byHarness.get(owner.scope.harness) ?? [];
          byHarness.set(owner.scope.harness, [...current, owner]);
        }

        for (const [harness, owners] of byHarness) {
          if (reportedHarnesses.has(harness)) continue;
          if (context.harness !== null && harness !== context.harness) continue;

          const stillConfigured = owners.every((owner) => {
            if (owner.owner === TOKEN_HARNESS_OWNER) return true;
            return (
              providerDetections.get(owner.owner)?.configuredHarnesses.includes(owner.scope.harness) ??
              false
            );
          });
          if (!stillConfigured) continue;

          report.pipelines.push({
            pipelineId: journal.appliedPipeline.pipelineId,
            harness: owners[0]?.scope.harness ?? (harness as HarnessManifest['id']),
            receiptId: journal.transactionId,
            appliedAt: journal.finishedAt ?? journal.startedAt,
            owners: [...owners],
          });
          reportedHarnesses.add(harness);
        }
      }
    }
  }

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

  const appliedOwnership = report.pipelines.flatMap((pipeline) => pipeline.owners);
  const findings = detectUnownedEntries({
    ownership: appliedOwnership.length > 0 ? appliedOwnership : resolution.ownership,
    configs,
    identify,
  });
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

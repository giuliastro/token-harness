/**
 * `token-harness verify` — RFC 0007, RFC 0006 §Tier-aware verification status.
 *
 * The command that answers "is it actually working", as opposed to "is it configured". RFC 0007
 * exists because those are different questions and the Phase 2.5 spike proved it: a hook can be
 * present, correct, and never fire.
 *
 * ## What it verifies against
 *
 * A receipt when there is one, and the live configuration when there is not. The second case is
 * not a degraded mode — RFC 0004 §Brownfield adoption makes an adopted installation the ordinary
 * one, and PLAN §2 asks for both verification and adoption in the same release. A `verify` that
 * required a receipt would refuse to run on the machine most likely to need it.
 *
 * ## Passive by default
 *
 * RFC 0007 §Active and passive canaries: a passive canary reads a receipt the provider already
 * wrote, and an active one costs a model call. This command runs the passive form only. Nothing
 * here spends tokens, and nothing here writes.
 *
 * ## Only a failure is a problem
 *
 * RFC 0006 §Tier-aware verification status: "only `fail` contributes to the problems-found exit
 * code. `info` never does, and a correctly functioning `config-only` installation is a `pass`."
 * `not-exercised` is also not a failure — RFC 0007 added it precisely so "nothing has happened
 * yet" stops being reported as "something is broken".
 */

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES,
  FileJournalStore,
  commandResult,
  contributesToProblems,
  diagnostic,
  type CommandResult,
  type Diagnostic,
  type HarnessConfigSummary,
  type VerificationResult,
  type VerifyReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export async function runVerify(context: CommandContext): Promise<CommandResult<VerifyReport>> {
  const diagnostics: Diagnostic[] = [];
  const results: VerificationResult[] = [];

  if (context.adapters === null) {
    return commandResult<VerifyReport>({
      command: 'verify',
      exitCode: EXIT_CODES.ok,
      data: { receiptId: null, appliedAt: null, results: [], healthyAtDeclaredTier: true },
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'nothing-to-verify',
          message: 'No harness was inspected, so there is nothing to verify',
          remediation: null,
        }),
      ],
    });
  }

  const detectionContext = {
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
  };

  /**
   * The harness side first, because a provider cannot be verified on a harness that is not
   * there — and because the harness adapters are what supply the configuration a provider
   * recognises itself in.
   */
  const harnessConfigs: HarnessConfigSummary[] = [];
  const presentHarnesses: string[] = [];
  for (const adapter of listHarnessAdapters()) {
    if (context.harness !== null && adapter.manifest.id !== context.harness) continue;
    const detection = await adapter.detect(detectionContext);
    if (detection.state === 'absent') continue;
    presentHarnesses.push(adapter.manifest.id);

    /**
     * A harness's own verification becomes diagnostics, not rows.
     *
     * RFC 0006's transcript makes every row `provider — harness`, and a `HarnessVerification`
     * has no provider: its subject is the harness itself — whether its hooks can be observed at
     * all, whether its enablement is separate state, which tool families a matcher covers.
     * Forcing it into a provider row would have to invent a provider for it.
     *
     * Nothing is lost by reporting it here: these are exactly the findings `doctor` already
     * surfaces as diagnostics, and the tool-family coverage gap from the Phase 2.5 spike is one
     * of them.
     */
    const verification = await adapter.verify(detectionContext);
    for (const check of verification.checks) {
      if (check.status === 'pass') continue;
      diagnostics.push(
        diagnostic({
          severity: check.status === 'fail' ? 'warning' : 'info',
          code: `harness-${check.id}`,
          message: `${adapter.manifest.displayName}: ${check.summary}`,
          remediation: check.remediation,
        }),
      );
    }

    const inspection = await adapter.inspect(detectionContext);
    harnessConfigs.push(...inspection.summaries);
    diagnostics.push(...inspection.diagnostics);
  }

  const managedIntegrations = await readManagedIntegrations(context);

  const providerContext = {
    ...detectionContext,
    harnessConfigs,
    now: context.now,
    localDatabase: context.adapters.localDatabase,
    projectIdFor: context.adapters.projectIdFor,
  };

  for (const adapter of listProviderAdapters()) {
    if (context.provider !== null && adapter.manifest.id !== context.provider) continue;

    const detection = await adapter.detect(providerContext);
    // A provider that is not here is not a failed verification. RFC 0006: "An empty environment
    // is a state, not a problem."
    if (detection.state === 'absent') continue;

    const verification = await adapter.verify(providerContext);
    diagnostics.push(...verification.diagnostics);

    /**
     * One result per harness the provider is wired to, because RFC 0007 makes a tier "per
     * harness, per version, and per tool family". A single row for a provider on three harnesses
     * would report one tier for three different situations.
     */
    const harnesses =
      detection.configuredHarnesses.length > 0
        ? detection.configuredHarnesses
        : // Installed but wired to nothing: still worth a row, on every present harness, because
          // "installed and not connected here" is the finding.
          presentHarnesses;

    for (const harnessId of harnesses) {
      /**
       * The tier the manifest declares for *this* harness, not the provider's overall one.
       *
       * The comment above says a tier is "per harness, per version, and per tool family", and the
       * loop existed to honour that — but every row still carried one provider-wide tier, which
       * made the per-harness field in the manifest decorative. It went unnoticed while every
       * provider declared the same tier on every harness it supported.
       *
       * RTK is the first that does not: its receipt is per-harness on Claude Code and provider-wide
       * on OpenCode, so it declares `canary` on one and `config-only` on the other. Reading the
       * provider-wide value here would print `canary` against OpenCode — the overclaim the
       * per-harness declaration exists to prevent.
       */
      const declaredTier =
        adapter.manifest.harnesses.find((entry) => entry.harness === harnessId)?.verificationTier ??
        verification.declaredTier;
      results.push({
        providerId: adapter.manifest.id,
        harnessId: harnessId as VerificationResult['harnessId'],
        status: statusFor(verification.achievedTier, declaredTier),
        declaredTier,
        managedByTokenHarness: managedIntegrations.has(`${adapter.manifest.id}\0${harnessId}`),
        providerManagedByTokenHarness: detection.managedByTokenHarness,
        checks: verification.checks,
      });
    }
  }

  /**
   * The receipt, when there is one.
   *
   * The most recent one wins: `listReceipts` returns them newest first, and a verification is a
   * statement about the current machine rather than about its history.
   */
  const receipts = context.metrics === null ? [] : await readReceipts(context);
  const latest = receipts[0] ?? null;

  const failures = results.flatMap((result) => result.checks.filter(contributesToProblems));

  const report: VerifyReport = {
    receiptId: latest?.receiptId ?? null,
    appliedAt: latest?.appliedAt ?? null,
    results,
    healthyAtDeclaredTier: failures.length === 0,
  };

  // RFC 0006 §Exit codes: 3 means, among other things, "a verification result below its declared
  // tier". Reserved for a `fail` — an `info` or a `not-exercised` never reaches it, which is what
  // keeps the exit code worth reading.
  return commandResult<VerifyReport>({
    command: 'verify',
    exitCode: failures.length === 0 ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
    data: report,
    diagnostics,
  });
}

async function readManagedIntegrations(context: CommandContext): Promise<Set<string>> {
  const managed = new Set<string>();
  if (context.adapters === null || context.stateRoot === null) return managed;

  const journalRoot = context.adapters.fs.join(context.stateRoot, 'journals');
  if ((await context.adapters.fs.stat(journalRoot)) === null) return managed;

  const projectId = context.adapters.projectIdFor(context.projectRoot);
  const store = new FileJournalStore({
    fs: context.adapters.fs,
    journalRoot,
    backupRoot: context.adapters.fs.join(context.stateRoot, 'backups'),
  });

  for (const journal of await store.list()) {
    if (journal.outcome !== 'committed' || journal.projectId !== projectId) continue;
    for (const integration of journal.managedIntegrations ?? []) {
      managed.add(`${integration.providerId}\0${integration.harnessId}`);
    }
  }
  return managed;
}

/**
 * Reads the stored receipts.
 *
 * Behind a helper because `MetricsStore` does not declare a list operation — `JsonlStore` does,
 * and RFC 0005 keeps the backend invisible. Asking through a capability check rather than adding
 * the method to the interface keeps a store that has no listing from being forced to invent one.
 */
async function readReceipts(
  context: CommandContext,
): Promise<{ receiptId: string; appliedAt: string }[]> {
  const store = context.metrics as {
    listReceipts?: () => Promise<{ receiptId: string; appliedAt: string }[]>;
  } | null;
  if (store?.listReceipts === undefined) return [];
  try {
    return await store.listReceipts();
  } catch {
    // A receipt that cannot be read does not make the live configuration unverifiable.
    return [];
  }
}

/**
 * RFC 0007: a tier below the declared one is the failure. Reaching it, or exceeding it, is not.
 *
 * `not-applicable` rather than `failed` when nothing could be established at all: that is the
 * `not-exercised` situation at the level of the whole result, and calling it a failure would
 * report an unused installation as a broken one.
 */
function statusFor(
  achieved: VerificationResult['declaredTier'] | null,
  declared: VerificationResult['declaredTier'],
): VerificationResult['status'] {
  const order = ['presence', 'config-only', 'canary', 'live-receipt'];
  if (achieved === null) return 'not-applicable';
  const reached = order.indexOf(achieved);
  const promised = order.indexOf(declared);
  if (reached < 0 || promised < 0) return 'not-applicable';
  return reached >= promised ? 'healthy' : 'degraded';
}

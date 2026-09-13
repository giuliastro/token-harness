import {
  MCPTOON_MARKER_BEGIN,
  MCPTOON_MARKER_END,
  planMcptoonManagedActivation,
  verifyMcptoonManagedActivation,
} from '@token-harness/adapters';
import {
  EXIT_CODES,
  FileJournalStore,
  TransactionSnapshotStore,
  commandResult,
  committedOwnership,
  diagnostic,
  digestText,
  executeTransaction,
  statusForExitCode,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type HarnessId,
  type OwnedArtifact,
  type PlannedAction,
} from '@token-harness/core';

import { validateCandidateCampaignRuntimeSurface } from './candidate-campaign-surface.js';
import type { CommandContext } from './context.js';

type CandidateMutationCommand = 'apply' | 'uninstall';

function emptyReport(outcome: ApplyReport['outcome']): ApplyReport {
  return {
    planId: null,
    transactionId: null,
    fromStoredPlan: false,
    outcome,
    results: [],
    unrestored: [],
    receiptId: null,
  };
}

function finish(
  command: CandidateMutationCommand,
  exitCode: ExitCode,
  report: ApplyReport,
  diagnostics: Diagnostic[],
): CommandResult<ApplyReport> {
  return commandResult<ApplyReport>({
    command,
    exitCode,
    data: statusForExitCode(exitCode) === 'error' ? null : report,
    diagnostics,
  });
}

function candidateTransactionId(kind: string, context: CommandContext): string {
  const digest = digestText(`${kind} ${context.projectRoot} ${context.now()}`);
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 13);
}

function providerContext(context: CommandContext) {
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

function selectorProblem(
  context: CommandContext,
  command: CandidateMutationCommand,
): Diagnostic | null {
  const candidate = context.optimizationCandidate ?? null;
  if (candidate !== 'mcptoon') {
    return diagnostic({
      severity: 'error',
      code: 'candidate-managed-lifecycle-unavailable',
      subject: candidate,
      message: `Managed candidate lifecycle is not reviewed for ${candidate ?? 'an unspecified candidate'}`,
      remediation:
        'Use the candidate-specific documented workflow until Token Harness has reviewed that lifecycle',
    });
  }
  if (context.harness === null) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-managed-harness-required',
      subject: candidate,
      message: 'Managed mcptoon lifecycle needs an explicit harness',
      remediation: 'Add --harness codex or --harness claude',
    });
  }
  if (
    context.provider !== null ||
    context.planId !== null ||
    context.nativePolicy === true ||
    context.agentSkill === true
  ) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-managed-selector-conflict',
      subject: candidate,
      message: `Candidate ${command} cannot be combined with provider, stored-plan, native-policy, or Agent Skill mutations`,
      remediation: `Run token-harness ${command} --candidate mcptoon --harness ${context.harness}${command === 'apply' ? ' --yes' : ' --yes'} on its own`,
    });
  }
  return null;
}

function stores(context: CommandContext, transactionId: string) {
  if (context.adapters === null || context.stateRoot === null) return null;
  const fs = context.adapters.fs;
  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId,
    projectRoot: context.projectRoot,
    now: context.now,
  });
  if (!creation.ok) return { fs, failure: creation.diagnostics } as const;
  return {
    fs,
    snapshots: creation.store,
    journal: new FileJournalStore({
      fs,
      journalRoot: fs.join(context.stateRoot, 'journals'),
      backupRoot: fs.join(context.stateRoot, 'backups'),
    }),
  } as const;
}

function reportFromTransaction(
  transactionId: string,
  transaction: Awaited<ReturnType<typeof executeTransaction>>,
): ApplyReport {
  return {
    planId: null,
    transactionId,
    fromStoredPlan: false,
    outcome:
      transaction.journal.outcome === 'committed'
        ? 'committed'
        : transaction.journal.outcome === 'rolled-back'
          ? 'rolled-back'
          : transaction.journal.outcome === 'dirty'
            ? 'dirty'
            : 'rejected',
    results: transaction.journal.entries.map((entry) => ({
      actionId: entry.actionId,
      kind: entry.kind,
      status: entry.status,
      path: entry.snapshots[0]?.path ?? null,
    })),
    unrestored: transaction.unrestored,
    receiptId: null,
  };
}

export async function runCandidateApply(
  context: CommandContext,
): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];
  const problem = selectorProblem(context, 'apply');
  if (problem !== null) {
    diagnostics.push(problem);
    return finish('apply', EXIT_CODES['usage-error'], emptyReport('rejected'), diagnostics);
  }
  const harness = context.harness as HarnessId;
  const surfaceProblem = await validateCandidateCampaignRuntimeSurface(context, false);
  if (surfaceProblem !== null) {
    diagnostics.push(surfaceProblem);
    return finish(
      'apply',
      EXIT_CODES['unsupported-environment'],
      emptyReport('rejected'),
      diagnostics,
    );
  }
  if (context.adapters === null || context.stateRoot === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        subject: 'mcptoon',
        message:
          'No transactional state directory is available, so mcptoon cannot be managed safely',
        remediation: null,
      }),
    );
    return finish(
      'apply',
      EXIT_CODES['unsupported-environment'],
      emptyReport('rejected'),
      diagnostics,
    );
  }

  const provider = providerContext(context)!;
  const plan = await planMcptoonManagedActivation(provider, harness);
  diagnostics.push(...plan.diagnostics);
  const before = await verifyMcptoonManagedActivation(provider, harness);
  if (plan.actions.length === 0) {
    if (before.state === 'verified') {
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'candidate-managed-already-active',
          subject: 'mcptoon',
          message: 'Reviewed mcptoon is already installed and active for this harness',
          remediation: null,
        }),
      );
      return finish('apply', EXIT_CODES.ok, emptyReport('nothing-to-do'), diagnostics);
    }
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'candidate-managed-activation-blocked',
        subject: 'mcptoon',
        message: `Token Harness cannot activate mcptoon safely: ${before.detail}`,
        path: plan.target ?? null,
        remediation:
          'Resolve the reported brownfield conflict, then retry the managed candidate activation',
      }),
    );
    return finish('apply', EXIT_CODES['blocked-by-conflict'], emptyReport('rejected'), diagnostics);
  }

  if (!context.confirmed) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        subject: 'mcptoon',
        message: `Managed mcptoon activation would run ${String(plan.actions.length)} reversible action${plan.actions.length === 1 ? '' : 's'}`,
        remediation: `Re-run with --yes to install the reviewed build if needed and activate it for ${harness}`,
      }),
    );
    return finish(
      'apply',
      EXIT_CODES['confirmation-required'],
      emptyReport('confirmation-required'),
      diagnostics,
    );
  }

  const transactionId = candidateTransactionId(`mcptoon-activate-${harness}`, context);
  const built = stores(context, transactionId);
  if (built === null || !('snapshots' in built)) {
    diagnostics.push(...(built?.failure ?? []));
    return finish(
      'apply',
      EXIT_CODES['unsupported-environment'],
      emptyReport('rejected'),
      diagnostics,
    );
  }

  const transaction = await executeTransaction({
    transactionId,
    planId: null,
    projectId: context.adapters.projectIdFor(context.projectRoot),
    projectRoot: context.projectRoot,
    actions: plan.actions,
    fs: built.fs,
    snapshots: built.snapshots,
    journal: built.journal as FileJournalStore,
    runner: context.adapters.runner,
    now: context.now,
    verifyPostconditions: async () => {
      const verification = await verifyMcptoonManagedActivation(provider, harness);
      return verification.state === 'verified'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'candidate-managed-postcondition-failed',
              subject: 'mcptoon',
              message: verification.detail,
              path: verification.target ?? null,
              remediation:
                'Token Harness will roll the candidate activation back rather than leave a partial state',
            }),
          ];
    },
  });
  diagnostics.push(...transaction.diagnostics);
  return finish(
    'apply',
    transaction.exitCode as ExitCode,
    reportFromTransaction(transactionId, transaction),
    diagnostics,
  );
}

async function guidancePresent(
  context: CommandContext,
  harness: HarnessId,
  target: string,
): Promise<boolean> {
  if (context.adapters === null) return false;
  const stat = await context.adapters.fs.stat(target);
  if (stat === null) return false;
  if (harness !== 'codex') return true;
  if (stat.kind !== 'file') return true;
  const text = new TextDecoder().decode(await context.adapters.fs.readFile(target));
  return text.includes(MCPTOON_MARKER_BEGIN) || text.includes(MCPTOON_MARKER_END);
}

function ownedTarget(
  artifacts: readonly OwnedArtifact[],
  target: string,
  harness: HarnessId,
): OwnedArtifact | null {
  return (
    artifacts.find((artifact) => {
      if (artifact.path !== target) return false;
      if (harness === 'codex') {
        return (
          artifact.kind === 'owned-marker-block' && artifact.markerBegin === MCPTOON_MARKER_BEGIN
        );
      }
      return artifact.kind === 'owned-file';
    }) ?? null
  );
}

export async function runCandidateUninstall(
  context: CommandContext,
): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];
  const problem = selectorProblem(context, 'uninstall');
  if (problem !== null) {
    diagnostics.push(problem);
    return finish('uninstall', EXIT_CODES['usage-error'], emptyReport('rejected'), diagnostics);
  }
  const harness = context.harness as HarnessId;
  if (context.adapters === null || context.stateRoot === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        subject: 'mcptoon',
        message:
          'No transaction history is available, so Token Harness cannot prove what mcptoon guidance it owns',
        remediation: null,
      }),
    );
    return finish(
      'uninstall',
      EXIT_CODES['unsupported-environment'],
      emptyReport('rejected'),
      diagnostics,
    );
  }

  const fs = context.adapters.fs;
  const target =
    harness === 'codex'
      ? fs.join(context.projectRoot, 'AGENTS.md')
      : fs.join(context.adapters.paths.home, '.claude', 'skills', 'mcptoon', 'SKILL.md');
  const present = await guidancePresent(context, harness, target);
  if (!present) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'candidate-managed-already-inactive',
        subject: 'mcptoon',
        message: 'mcptoon agent guidance is already inactive for this harness',
        path: target,
        remediation: null,
      }),
    );
    return finish('uninstall', EXIT_CODES.ok, emptyReport('nothing-to-do'), diagnostics);
  }

  const journals = new FileJournalStore({
    fs,
    journalRoot: fs.join(context.stateRoot, 'journals'),
    backupRoot: fs.join(context.stateRoot, 'backups'),
  });
  const history = (await journals.list())
    .filter((journal) => journal.outcome === 'committed')
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));

  let sourceTransactionId: string | null = null;
  let owned: OwnedArtifact | null = null;
  for (const journal of history) {
    if (!journal.entries.some((entry) => entry.actionId.startsWith(`mcptoon:${harness}:`)))
      continue;
    const candidateOwned = ownedTarget(committedOwnership(journal), target, harness);
    if (candidateOwned === null) continue;
    sourceTransactionId = journal.transactionId;
    owned = candidateOwned;
    break;
  }

  if (sourceTransactionId === null || owned === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'candidate-managed-guidance-not-owned',
        subject: 'mcptoon',
        message: 'mcptoon guidance is present, but no committed Token Harness transaction owns it',
        path: target,
        remediation:
          'Leave user-owned guidance untouched or remove it explicitly outside Token Harness',
      }),
    );
    return finish(
      'uninstall',
      EXIT_CODES['blocked-by-conflict'],
      emptyReport('rejected'),
      diagnostics,
    );
  }

  const action: PlannedAction = {
    kind: 'remove-owned-change',
    id: `mcptoon:${harness}:candidate-deactivate:${sourceTransactionId}`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['The recorded mcptoon guidance still matches the committed ownership receipt'],
    postconditions: ['Only Token Harness-owned mcptoon guidance is removed'],
    rollbackData: 'file-snapshot',
    explanation:
      'Deactivate mcptoon for the baseline without touching unrelated user configuration',
    path: target,
    reverses: harness === 'codex' ? 'mcptoon:codex:agents' : 'mcptoon:claude:skill',
    target: owned,
  };

  if (!context.confirmed) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        subject: 'mcptoon',
        message: 'Token Harness will remove only the mcptoon guidance it recorded as its own',
        path: target,
        remediation: 'Re-run with --yes to deactivate mcptoon before the baseline',
      }),
    );
    return finish(
      'uninstall',
      EXIT_CODES['confirmation-required'],
      emptyReport('confirmation-required'),
      diagnostics,
    );
  }

  const transactionId = candidateTransactionId(`mcptoon-deactivate-${harness}`, context);
  const built = stores(context, transactionId);
  if (built === null || !('snapshots' in built)) {
    diagnostics.push(...(built?.failure ?? []));
    return finish(
      'uninstall',
      EXIT_CODES['unsupported-environment'],
      emptyReport('rejected'),
      diagnostics,
    );
  }

  const transaction = await executeTransaction({
    transactionId,
    planId: null,
    projectId: context.adapters.projectIdFor(context.projectRoot),
    projectRoot: context.projectRoot,
    actions: [action],
    fs: built.fs,
    snapshots: built.snapshots,
    journal: built.journal as FileJournalStore,
    runner: context.adapters.runner,
    now: context.now,
    verifyPostconditions: async () =>
      (await guidancePresent(context, harness, target))
        ? [
            diagnostic({
              severity: 'error',
              code: 'candidate-managed-deactivation-postcondition-failed',
              subject: 'mcptoon',
              message: 'Owned mcptoon guidance is still present after deactivation',
              path: target,
              remediation:
                'Token Harness will roll the removal back rather than claim a clean baseline',
            }),
          ]
        : [],
  });
  diagnostics.push(...transaction.diagnostics);
  if (transaction.journal.outcome === 'committed') {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'candidate-managed-binary-retained',
        subject: 'mcptoon',
        message:
          'mcptoon remains installed at the reviewed version for later pairs; only agent guidance was deactivated',
        remediation: null,
      }),
    );
  }
  return finish(
    'uninstall',
    transaction.exitCode as ExitCode,
    reportFromTransaction(transactionId, transaction),
    diagnostics,
  );
}

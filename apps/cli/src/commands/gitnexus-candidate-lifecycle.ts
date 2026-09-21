import {
  GITNEXUS_CLAUDE_MCP_POINTER,
  GITNEXUS_MCP_SERVER,
  planGitNexusManagedMcpActivation,
  planGitNexusManagedMcpRemoval,
  verifyGitNexusManagedMcpActivation,
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
  jsonValueDigest,
  parseJsonDocumentText,
  parseJsonPointer,
  resolveJsonPointer,
  statusForExitCode,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type OwnedArtifact,
} from '@token-harness/core';

import { validateCandidateCampaignRuntimeSurface } from './candidate-campaign-surface.js';
import type { CommandContext } from './context.js';
import { repositoryRootForBackupSafety } from './snapshot-safety.js';

const ACTIVATION_ACTION_ID = 'gitnexus:claude:mcp-server';
const REMOVAL_ACTION_ID = 'gitnexus:claude:mcp-server:remove';
const REVIEWED_VALUE_DIGEST = jsonValueDigest(GITNEXUS_MCP_SERVER);

type MutationCommand = 'apply' | 'uninstall';
type ConfigState = 'absent' | 'reviewed' | 'different' | 'degraded';

interface ConfigInspection {
  state: ConfigState;
  target: string | null;
  detail: string;
}

interface ActiveOwnership {
  transactionId: string;
  artifact: OwnedArtifact;
}

function emptyReport(outcome: ApplyReport['outcome'], requestedStateVerified = false): ApplyReport {
  return {
    planId: null,
    transactionId: null,
    fromStoredPlan: false,
    outcome,
    results: [],
    unrestored: [],
    receiptId: null,
    ...(requestedStateVerified ? { requestedStateVerified: true } : {}),
  };
}

function finish(
  command: MutationCommand,
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

function transactionId(kind: string, context: CommandContext): string {
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
    env: context.env,
    harnessConfigs: [],
    now: context.now,
    localDatabase: context.adapters.localDatabase,
    projectIdFor: context.adapters.projectIdFor,
  };
}

function selectorProblem(context: CommandContext, command: MutationCommand): Diagnostic | null {
  if (context.harness !== 'claude') {
    return diagnostic({
      severity: 'error',
      code: 'candidate-managed-harness-unreviewed',
      subject: 'gitnexus',
      message: 'Managed GitNexus lifecycle is reviewed only for Claude Code',
      remediation: 'Use --harness claude on the exact reviewed Linux compatibility row',
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
      subject: 'gitnexus',
      message: `Candidate ${command} cannot be combined with provider, stored-plan, native-policy, or Agent Skill mutations`,
      remediation: `Run token-harness ${command} --candidate gitnexus --harness claude --yes on its own`,
    });
  }
  return null;
}

async function stores(context: CommandContext, id: string) {
  if (context.adapters === null || context.stateRoot === null) return null;
  const fs = context.adapters.fs;
  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId: id,
    projectRoot: await repositoryRootForBackupSafety(context),
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
  id: string,
  transaction: Awaited<ReturnType<typeof executeTransaction>>,
): ApplyReport {
  return {
    planId: null,
    transactionId: id,
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
    ...(transaction.journal.outcome === 'committed' ? { requestedStateVerified: true } : {}),
  };
}

async function inspectConfig(context: CommandContext): Promise<ConfigInspection> {
  if (context.adapters === null) {
    return { state: 'degraded', target: null, detail: 'Runtime adapters are unavailable' };
  }
  const fs = context.adapters.fs;
  const target = fs.join(context.adapters.paths.home, '.claude.json');
  const stat = await fs.stat(target);
  if (stat === null) return { state: 'absent', target, detail: 'Claude user config is absent' };
  if (stat.kind !== 'file') {
    return { state: 'degraded', target, detail: 'Claude user config is not a regular file' };
  }

  const parsed = parseJsonDocumentText(new TextDecoder().decode(await fs.readFile(target)));
  if (parsed.state !== 'parsed') {
    return {
      state: 'degraded',
      target,
      detail:
        parsed.state === 'comments'
          ? 'Claude user config contains unsupported JSON comments'
          : `Claude user config is malformed: ${parsed.reason}`,
    };
  }
  const segments = parseJsonPointer(GITNEXUS_CLAUDE_MCP_POINTER);
  if (segments === null) {
    return { state: 'degraded', target, detail: 'Internal GitNexus MCP pointer is invalid' };
  }
  const live = resolveJsonPointer(parsed.document, segments);
  if (!live.found || live.value === undefined) {
    return { state: 'absent', target, detail: 'GitNexus MCP entry is absent' };
  }
  return jsonValueDigest(live.value) === REVIEWED_VALUE_DIGEST
    ? { state: 'reviewed', target, detail: 'GitNexus MCP entry matches the reviewed command' }
    : {
        state: 'different',
        target,
        detail: 'GitNexus MCP entry differs from the reviewed command',
      };
}

function matchingOwnership(
  artifacts: readonly OwnedArtifact[],
  target: string,
): OwnedArtifact | null {
  return (
    artifacts.find(
      (artifact) =>
        artifact.kind === 'owned-json-entry' &&
        artifact.path === target &&
        artifact.pointer === GITNEXUS_CLAUDE_MCP_POINTER &&
        artifact.placement === 'value' &&
        artifact.valueDigest === REVIEWED_VALUE_DIGEST,
    ) ?? null
  );
}

async function activeOwnership(
  context: CommandContext,
  target: string,
): Promise<ActiveOwnership | null> {
  if (context.adapters === null || context.stateRoot === null) return null;
  const fs = context.adapters.fs;
  const journals = new FileJournalStore({
    fs,
    journalRoot: fs.join(context.stateRoot, 'journals'),
    backupRoot: fs.join(context.stateRoot, 'backups'),
  });
  const history = (await journals.list())
    .filter((journal) => journal.outcome === 'committed')
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));

  for (const journal of history) {
    const relevant = journal.entries.find(
      (entry) => entry.actionId === ACTIVATION_ACTION_ID || entry.actionId === REMOVAL_ACTION_ID,
    );
    if (relevant === undefined) continue;
    if (relevant.actionId === REMOVAL_ACTION_ID) return null;
    const artifact = matchingOwnership(committedOwnership(journal), target);
    return artifact === null ? null : { transactionId: journal.transactionId, artifact };
  }
  return null;
}

async function exactRuntimeProblem(context: CommandContext): Promise<Diagnostic | null> {
  // The shared campaign gate is the canonical exact-row/version check. A managed activation is an
  // optimized-like boundary, so force the otherwise read-only matrix context through that gate.
  return validateCandidateCampaignRuntimeSurface(
    { ...context, benchmarkVariant: 'optimized' },
    true,
    false,
  );
}

export async function runGitNexusCandidateApply(
  context: CommandContext,
): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];
  const problem = selectorProblem(context, 'apply');
  if (problem !== null) {
    return finish('apply', EXIT_CODES['usage-error'], emptyReport('rejected'), [problem]);
  }
  if (context.adapters === null || context.stateRoot === null) {
    return finish('apply', EXIT_CODES['unsupported-environment'], emptyReport('rejected'), [
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        subject: 'gitnexus',
        message:
          'No transactional state directory is available, so GitNexus cannot be managed safely',
        remediation: null,
      }),
    ]);
  }

  const surfaceProblem = await exactRuntimeProblem(context);
  if (surfaceProblem !== null) {
    return finish('apply', EXIT_CODES['unsupported-environment'], emptyReport('rejected'), [
      surfaceProblem,
    ]);
  }

  const inspection = await inspectConfig(context);
  const target = inspection.target;
  if (inspection.state === 'reviewed' && target !== null) {
    const ownership = await activeOwnership(context, target);
    if (ownership === null) {
      return finish('apply', EXIT_CODES['blocked-by-conflict'], emptyReport('rejected'), [
        diagnostic({
          severity: 'error',
          code: 'candidate-managed-guidance-not-owned',
          subject: 'gitnexus',
          message: 'The reviewed GitNexus MCP entry is already present but remains user-owned',
          path: target,
          remediation:
            'Leave the user-owned entry untouched; use a clean Token Harness-owned activation for a repeatable benchmark pair',
        }),
      ]);
    }
    const verification = await verifyGitNexusManagedMcpActivation(
      providerContext(context)!,
      context.harness!,
    );
    if (verification.state !== 'verified') {
      return finish('apply', EXIT_CODES['unsupported-environment'], emptyReport('rejected'), [
        diagnostic({
          severity: 'error',
          code: 'candidate-managed-activation-blocked',
          subject: 'gitnexus',
          message: `Token Harness cannot verify the managed GitNexus activation: ${verification.detail}`,
          path: target,
          remediation: 'Restore the exact reviewed GitNexus runtime before continuing the campaign',
        }),
      ]);
    }
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'candidate-managed-already-active',
        subject: 'gitnexus',
        message: 'GitNexus is already active through the Token Harness-owned Claude MCP entry',
        path: target,
        remediation: null,
      }),
    );
    return finish('apply', EXIT_CODES.ok, emptyReport('nothing-to-do', true), diagnostics);
  }
  if (inspection.state !== 'absent') {
    return finish('apply', EXIT_CODES['blocked-by-conflict'], emptyReport('rejected'), [
      diagnostic({
        severity: 'error',
        code: 'candidate-managed-activation-blocked',
        subject: 'gitnexus',
        message: `Token Harness cannot safely activate GitNexus: ${inspection.detail}`,
        path: target,
        remediation: 'Resolve the Claude MCP configuration conflict manually, then retry',
      }),
    ]);
  }

  const provider = providerContext(context)!;
  const plan = await planGitNexusManagedMcpActivation(provider, context.harness!);
  diagnostics.push(...plan.diagnostics);
  if (plan.actions.length === 0) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'candidate-managed-activation-blocked',
        subject: 'gitnexus',
        message: 'Token Harness could not produce the reviewed GitNexus MCP activation action',
        path: plan.target ?? target,
        remediation:
          'Keep GitNexus user-owned and inspect the reported prerequisite before retrying',
      }),
    );
    return finish('apply', EXIT_CODES['blocked-by-conflict'], emptyReport('rejected'), diagnostics);
  }

  if (!context.confirmed) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        subject: 'gitnexus',
        message: 'Managed GitNexus activation would add one reversible Claude MCP entry',
        path: plan.target ?? target,
        remediation:
          'Re-run with --yes to register the already-installed reviewed GitNexus CLI; Token Harness will not install or index anything',
      }),
    );
    return finish(
      'apply',
      EXIT_CODES['confirmation-required'],
      emptyReport('confirmation-required'),
      diagnostics,
    );
  }

  const id = transactionId('gitnexus-activate-claude', context);
  const built = await stores(context, id);
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
    transactionId: id,
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
      const verification = await verifyGitNexusManagedMcpActivation(provider, context.harness!);
      return verification.state === 'verified'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'candidate-managed-postcondition-failed',
              subject: 'gitnexus',
              message: verification.detail,
              path: verification.target,
              remediation:
                'Token Harness will roll back the MCP registration rather than leave a partial activation',
            }),
          ];
    },
  });
  diagnostics.push(...transaction.diagnostics);
  return finish(
    'apply',
    transaction.exitCode as ExitCode,
    reportFromTransaction(id, transaction),
    diagnostics,
  );
}

export async function runGitNexusCandidateUninstall(
  context: CommandContext,
): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];
  const problem = selectorProblem(context, 'uninstall');
  if (problem !== null) {
    return finish('uninstall', EXIT_CODES['usage-error'], emptyReport('rejected'), [problem]);
  }
  if (context.adapters === null || context.stateRoot === null) {
    return finish('uninstall', EXIT_CODES['unsupported-environment'], emptyReport('rejected'), [
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        subject: 'gitnexus',
        message:
          'No transaction history is available, so Token Harness cannot prove which GitNexus MCP entry it owns',
        remediation: null,
      }),
    ]);
  }

  const inspection = await inspectConfig(context);
  const target = inspection.target;
  if (inspection.state === 'absent') {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'candidate-managed-already-inactive',
        subject: 'gitnexus',
        message: 'GitNexus MCP registration is already absent for Claude Code',
        path: target,
        remediation: null,
      }),
    );
    return finish('uninstall', EXIT_CODES.ok, emptyReport('nothing-to-do', true), diagnostics);
  }
  if (inspection.state !== 'reviewed' || target === null) {
    return finish('uninstall', EXIT_CODES['blocked-by-conflict'], emptyReport('rejected'), [
      diagnostic({
        severity: 'error',
        code: 'candidate-managed-deactivation-blocked',
        subject: 'gitnexus',
        message: `Token Harness will not remove the GitNexus MCP entry: ${inspection.detail}`,
        path: target,
        remediation: 'Review the user-owned or drifted Claude MCP configuration manually',
      }),
    ]);
  }

  const ownership = await activeOwnership(context, target);
  if (ownership === null) {
    return finish('uninstall', EXIT_CODES['blocked-by-conflict'], emptyReport('rejected'), [
      diagnostic({
        severity: 'error',
        code: 'candidate-managed-guidance-not-owned',
        subject: 'gitnexus',
        message:
          'GitNexus MCP registration is present, but no active Token Harness transaction owns it',
        path: target,
        remediation:
          'Leave the user-owned entry untouched or remove it explicitly outside Token Harness',
      }),
    ]);
  }

  const provider = providerContext(context)!;
  const plan = planGitNexusManagedMcpRemoval(provider, ownership.artifact);
  diagnostics.push(...plan.diagnostics);
  if (plan.actions.length !== 1) {
    return finish(
      'uninstall',
      EXIT_CODES['blocked-by-conflict'],
      emptyReport('rejected'),
      diagnostics,
    );
  }

  if (!context.confirmed) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        subject: 'gitnexus',
        message:
          'Token Harness will remove only the GitNexus Claude MCP entry it recorded as its own',
        path: target,
        remediation: 'Re-run with --yes to deactivate GitNexus before the baseline',
      }),
    );
    return finish(
      'uninstall',
      EXIT_CODES['confirmation-required'],
      emptyReport('confirmation-required'),
      diagnostics,
    );
  }

  const id = transactionId('gitnexus-deactivate-claude', context);
  const built = await stores(context, id);
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
    transactionId: id,
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
      const after = await inspectConfig(context);
      return after.state === 'absent'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'candidate-managed-deactivation-postcondition-failed',
              subject: 'gitnexus',
              message: 'The owned GitNexus MCP entry is still present after deactivation',
              path: target,
              remediation:
                'Token Harness will roll back the removal rather than claim a clean baseline',
            }),
          ];
    },
  });
  diagnostics.push(...transaction.diagnostics);
  return finish(
    'uninstall',
    transaction.exitCode as ExitCode,
    reportFromTransaction(id, transaction),
    diagnostics,
  );
}

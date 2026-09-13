/**
 * Recording-only lifecycle driver for the mcptoon × Codex RFC 0009 fixture.
 *
 * This deliberately lives under tests/tools and never enters the shipped CLI. mcptoon is not yet a
 * global ProviderAdapter, so the normal CLI must continue refusing a provider-registry promotion.
 * The recorder still needs the production lifecycle mechanics, though: this driver calls the
 * reviewed mcptoon planner and the same transaction, snapshot, rollback and owned-change executors
 * production uses. It is evidence scaffolding, not a force flag.
 */

import process from 'node:process';

import {
  FileJournalStore,
  TransactionSnapshotStore,
  committedOwnership,
  diagnostic,
  executeTransaction,
  harnessId,
  rollbackTransaction,
} from '@token-harness/core';
import {
  planMcptoonManagedActivation,
  verifyMcptoonManagedActivation,
} from '@token-harness/adapters';
import { NodeFileSystem, nodeSystemProbe, resolveHostEnvironment } from '@token-harness/platform';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${arg.slice(2)} needs a value`);
    }
    args[arg.slice(2)] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const operation = args.operation ?? 'apply';
if (!['apply', 'rollback', 'uninstall'].includes(operation)) {
  throw new Error('--operation must be apply, rollback, or uninstall');
}
for (const required of ['project', 'home', 'transaction-id']) {
  if (args[required] === undefined) throw new Error(`--${required} is required`);
}
if (operation === 'uninstall' && args['source-transaction-id'] === undefined) {
  throw new Error('--source-transaction-id is required for uninstall');
}

const baseProbe = nodeSystemProbe();
const probe = {
  ...baseProbe,
  homeDirectory: args.home,
  env: {
    ...baseProbe.env,
    HOME: args.home,
    USERPROFILE: args.home,
    LOCALAPPDATA: `${args.home}/state`,
    XDG_CONFIG_HOME: `${args.home}/.config`,
    XDG_DATA_HOME: `${args.home}/.local/share`,
    XDG_STATE_HOME: `${args.home}/.local/state`,
    XDG_CACHE_HOME: `${args.home}/.cache`,
  },
};

const resolution = resolveHostEnvironment({ probe });
if (!resolution.ok) {
  for (const entry of resolution.diagnostics)
    process.stderr.write(`${entry.code}: ${entry.message}\n`);
  process.exit(9);
}

const environment = resolution.environment;
const facts = environment.facts;
const fs = new NodeFileSystem(facts);
const stateRoot = environment.paths.state;
const projectRoot = args.project;
const transactionId = args['transaction-id'];
const now = () => new Date().toISOString();

const providerContext = {
  fs,
  runner: environment.runner,
  facts,
  paths: environment.paths,
  projectRoot,
  harnessConfigs: [],
  now,
  localDatabase: null,
  projectIdFor: () => 'p_unattributed',
};

function journalStore() {
  return new FileJournalStore({
    fs,
    journalRoot: fs.join(stateRoot, 'journals'),
    backupRoot: fs.join(stateRoot, 'backups'),
  });
}

function stores(id) {
  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(stateRoot, 'backups'),
    transactionId: id,
    projectRoot,
    now,
  });
  if (!creation.ok) {
    throw new Error(
      creation.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('; '),
    );
  }
  return { snapshots: creation.store, journal: journalStore() };
}

function emit(result) {
  process.stdout.write(
    `${JSON.stringify(
      {
        operation,
        transactionId,
        outcome: result.journal?.outcome ?? null,
        exitCode: result.exitCode,
        diagnostics: result.diagnostics.map((entry) => ({
          severity: entry.severity,
          code: entry.code,
          message: entry.message,
          path: entry.path,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

async function apply() {
  const plan = await planMcptoonManagedActivation(providerContext, harnessId('codex'));
  const planningErrors = plan.diagnostics.filter((entry) => entry.severity === 'error');
  if (planningErrors.length > 0) {
    throw new Error(planningErrors.map((entry) => `${entry.code}: ${entry.message}`).join('; '));
  }
  if (plan.actions.length === 0) {
    throw new Error(
      `mcptoon recording apply produced no actions: ${plan.diagnostics.map((entry) => entry.code).join(', ')}`,
    );
  }

  const built = stores(transactionId);
  const result = await executeTransaction({
    transactionId,
    planId: null,
    projectId: 'p_unattributed',
    projectRoot,
    actions: plan.actions,
    fs,
    snapshots: built.snapshots,
    journal: built.journal,
    runner: environment.runner,
    now,
    verifyPostconditions: async () => {
      const verification = await verifyMcptoonManagedActivation(
        providerContext,
        harnessId('codex'),
      );
      return verification.state === 'verified'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'mcptoon-recording-postcondition',
              message: verification.detail,
              path: verification.target,
              remediation: null,
            }),
          ];
    },
  });
  emit(result);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

async function rollback() {
  const built = stores(transactionId);
  const result = await rollbackTransaction({
    transactionId,
    fs,
    snapshots: built.snapshots,
    journal: built.journal,
    runner: environment.runner,
    cwd: projectRoot,
    now,
  });
  emit(result);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

async function uninstall() {
  const sourceId = args['source-transaction-id'];
  const journals = journalStore();
  const source = await journals.read(sourceId);
  if (source === null || source.outcome !== 'committed') {
    throw new Error(`source transaction ${sourceId} is not a committed transaction`);
  }
  const targetPath = fs.join(projectRoot, 'AGENTS.md');
  const owned = committedOwnership(source).find(
    (artifact) => artifact.kind === 'owned-marker-block' && artifact.path === targetPath,
  );
  if (owned === undefined) {
    throw new Error(`source transaction ${sourceId} owns no mcptoon marker in ${targetPath}`);
  }

  const action = {
    kind: 'remove-owned-change',
    id: `mcptoon:codex:recording-uninstall:${sourceId}`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [targetPath],
    affectedProcesses: [],
    preconditions: [
      'The recorded mcptoon marker block still matches the committed ownership receipt',
    ],
    postconditions: ['Only the recorded mcptoon marker block is removed'],
    rollbackData: 'file-snapshot',
    explanation: 'Remove the exact mcptoon marker block owned by the fixture source transaction',
    path: targetPath,
    reverses: 'mcptoon:codex:agents',
    target: owned,
  };

  const built = stores(transactionId);
  const result = await executeTransaction({
    transactionId,
    planId: null,
    projectId: 'p_unattributed',
    projectRoot,
    actions: [action],
    fs,
    snapshots: built.snapshots,
    journal: built.journal,
    runner: environment.runner,
    now,
    verifyPostconditions: async () => {
      const verification = await verifyMcptoonManagedActivation(
        providerContext,
        harnessId('codex'),
      );
      return verification.state === 'not-configured'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'mcptoon-recording-uninstall-postcondition',
              message: `Expected mcptoon guidance to be absent, observed ${verification.state}: ${verification.detail}`,
              path: verification.target,
              remediation: null,
            }),
          ];
    },
  });
  emit(result);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

if (operation === 'apply') await apply();
else if (operation === 'rollback') await rollback();
else await uninstall();

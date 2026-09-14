/**
 * Recording-only lifecycle driver for the GitNexus × Claude Code RFC 0009 fixture.
 *
 * This is evidence scaffolding, not a shipped installer or escape hatch. It exercises the production
 * GitNexus Claude MCP planner/removal helpers plus the same transaction, snapshot, rollback and
 * owned-change executors used by Token Harness. It never runs GitNexus setup, analyze, indexing,
 * hooks, skills, or the MCP server itself.
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
  GITNEXUS_CLAUDE_MCP_POINTER,
  planGitNexusManagedMcpActivation,
  planGitNexusManagedMcpRemoval,
  verifyGitNexusManagedMcpActivation,
} from '@token-harness/adapters';
import { NodeFileSystem, nodeSystemProbe, resolveHostEnvironment } from '@token-harness/platform';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
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
    GITNEXUS_HOME: `${args.home}/.gitnexus`,
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
const claude = harnessId('claude');

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
        ownership: result.journal?.ownership ?? [],
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
  const plan = await planGitNexusManagedMcpActivation(providerContext, claude);
  const planningErrors = plan.diagnostics.filter((entry) => entry.severity === 'error');
  if (planningErrors.length > 0) {
    throw new Error(planningErrors.map((entry) => `${entry.code}: ${entry.message}`).join('; '));
  }
  if (plan.actions.length === 0) {
    throw new Error(
      `GitNexus Claude recording apply produced no actions: ${plan.diagnostics.map((entry) => entry.code).join(', ')}`,
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
      const verification = await verifyGitNexusManagedMcpActivation(providerContext, claude);
      return verification.state === 'verified'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'gitnexus-claude-recording-postcondition',
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
    throw new Error(`source transaction ${sourceId} is not committed`);
  }

  const targetPath = fs.join(args.home, '.claude.json');
  const owned = committedOwnership(source).find(
    (artifact) =>
      artifact.kind === 'owned-json-entry' &&
      artifact.path === targetPath &&
      artifact.pointer === GITNEXUS_CLAUDE_MCP_POINTER,
  );
  if (owned === undefined) {
    throw new Error(
      `source transaction ${sourceId} owns no GitNexus Claude MCP entry at ${targetPath}`,
    );
  }

  const plan = planGitNexusManagedMcpRemoval(providerContext, owned);
  const planningErrors = plan.diagnostics.filter((entry) => entry.severity === 'error');
  if (planningErrors.length > 0) {
    throw new Error(planningErrors.map((entry) => `${entry.code}: ${entry.message}`).join('; '));
  }
  if (plan.actions.length === 0) {
    throw new Error(
      `GitNexus Claude recording uninstall produced no actions: ${plan.diagnostics.map((entry) => entry.code).join(', ')}`,
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
      const verification = await verifyGitNexusManagedMcpActivation(providerContext, claude);
      return verification.state === 'not-configured'
        ? []
        : [
            diagnostic({
              severity: 'error',
              code: 'gitnexus-claude-recording-uninstall-postcondition',
              message: `Expected GitNexus MCP entry absent, observed ${verification.state}: ${verification.detail}`,
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

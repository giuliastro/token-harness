import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXIT_CODES,
  commandResult,
  harnessId,
  providerId,
  type ApplyReport,
  type BudgetReport,
  type DoctorReport,
  type PlanReport,
  type PlatformFacts,
  type VerifyReport,
} from '@token-harness/core';

import type { CommandContext } from '../src/commands/context.js';
import { runSetup, type SetupOperations } from '../src/commands/setup.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

const CONTEXT: CommandContext = {
  platform: PLATFORM,
  projectRoot: '/work/demo',
  home: '/home/dev',
  stateRoot: null,
  harness: null,
  provider: null,
  since: null,
  until: null,
  planId: null,
  confirmed: false,
  metrics: null,
  adapters: null,
  compatibilityRows: null,
  now: () => '2026-09-05T12:00:00.000Z',
};

const DOCTOR: DoctorReport = {
  platform: PLATFORM,
  problemCount: 0,
  harnesses: [
    {
      harnessId: harnessId('claude'),
      state: 'detected',
      version: '2.1.220',
      versionVerdict: 'in-range',
      configPath: '/home/dev/.claude/settings.json',
      declaredVerificationTier: 'canary',
      evidence: [],
      warnings: [],
    },
  ],
  providers: [
    {
      providerId: providerId('rtk'),
      state: 'installed',
      version: '0.44.0',
      executable: '/usr/bin/rtk',
      installationChannel: null,
      versionVerdict: 'in-range',
      configuredHarnesses: [],
      unmanagedHarnessesConfigured: [],
      supportsUnmanagedHarnesses: false,
      managedByTokenHarness: false,
      assignableHarnesses: [harnessId('claude')],
      evidence: [],
      warnings: [],
    },
  ],
};

const PLAN: PlanReport = {
  planId: 'deadbeef',
  profile: 'safe',
  harness: harnessId('claude'),
  projectRoot: '/work/demo',
  projectId: 'p_demo',
  pipelineId: 'pipeline-demo',
  ownership: [],
  exclusions: [],
  actions: [
    {
      kind: 'create-directory',
      id: 'prepare-owned-state',
      path: '/home/dev/.claude/token-harness',
      riskClass: 'reversible',
      requiresNetwork: false,
      requiresElevation: false,
      affectedPaths: ['/home/dev/.claude/token-harness'],
      affectedProcesses: [],
      preconditions: ['directory is absent'],
      postconditions: ['directory exists'],
      rollbackData: 'directory-snapshot',
      explanation: 'Prepare the reviewed integration directory.',
    },
  ],
  conflicts: [],
  network: [],
  elevation: [],
  backups: { files: 0 },
  persisted: true,
};

const APPLIED: ApplyReport = {
  planId: 'deadbeef',
  transactionId: 'transaction-demo',
  fromStoredPlan: true,
  outcome: 'committed',
  results: [
    {
      actionId: 'prepare-owned-state',
      kind: 'create-directory',
      status: 'applied',
      path: '/home/dev/.claude/token-harness',
    },
  ],
  unrestored: [],
  receiptId: 'transaction-demo',
};

const VERIFIED: VerifyReport = {
  receiptId: 'transaction-demo',
  appliedAt: '2026-09-05T12:00:00.000Z',
  results: [],
  healthyAtDeclaredTier: true,
};

const BUDGET: BudgetReport = {
  platform: PLATFORM,
  observedAt: '2026-09-05T12:00:00.000Z',
  harnesses: [],
};

function operations(onApply: (context: CommandContext) => void = () => {}): SetupOperations {
  return {
    doctor: async () => commandResult({ command: 'doctor', exitCode: EXIT_CODES.ok, data: DOCTOR }),
    plan: async () => commandResult({ command: 'plan', exitCode: EXIT_CODES.ok, data: PLAN }),
    apply: async (context) => {
      onApply(context);
      return commandResult({ command: 'apply', exitCode: EXIT_CODES.ok, data: APPLIED });
    },
    verify: async () =>
      commandResult({ command: 'verify', exitCode: EXIT_CODES.ok, data: VERIFIED }),
    budget: async () => commandResult({ command: 'budget', exitCode: EXIT_CODES.ok, data: BUDGET }),
  };
}

describe('setup command', () => {
  it('treats an empty environment as a safe state and changes nothing', async () => {
    const result = await runSetup(CONTEXT);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.stage, 'needs-harness');
    assert.equal(result.data?.changed, false);
    assert.equal(result.data?.nextStep.command, null);
    assert.match(result.data?.nextStep.description ?? '', /Claude Code or Codex/);
  });

  it('prepares one stored safe plan without applying it', async () => {
    let applied = false;
    const result = await runSetup(
      CONTEXT,
      operations(() => (applied = true)),
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.stage, 'ready-to-configure');
    assert.equal(result.data?.changed, false);
    assert.equal(result.data?.nextStep.command, 'token-harness setup --yes');
    assert.equal(applied, false);
  });

  it('applies the stored plan and verifies it only after explicit confirmation', async () => {
    let appliedPlan: string | null = null;
    const result = await runSetup(
      { ...CONTEXT, confirmed: true },
      operations((context) => {
        appliedPlan = context.planId;
      }),
    );

    assert.equal(appliedPlan, 'deadbeef');
    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.stage, 'ready');
    assert.equal(result.data?.changed, true);
    assert.equal(result.data?.verify?.healthyAtDeclaredTier, true);
    assert.equal(result.data?.nextStep.command, 'token-harness ui');
  });
});

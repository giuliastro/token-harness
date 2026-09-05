import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  digestText,
  harnessId,
  type BudgetReport,
  type CrossHarnessTransferReceipt,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
  type UsageWindowSnapshot,
} from '@token-harness/core';

import { scheduleMain } from '../src/schedule-main.js';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    streams: {
      out(text: string) {
        stdout += text;
      },
      err(text: string) {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

const base = ['--current', 'claude', '--candidate', 'codex', '--task-class', 'hard'] as const;
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const OBSERVED_AT = '2026-09-04T13:00:00.000Z';

function usageWindow(
  id: typeof CLAUDE,
  scope: 'five-hour' | 'weekly',
  usedPercent: number,
): UsageWindowSnapshot {
  return {
    harnessId: id,
    bucketId: `${id}-${scope}`,
    bucketName: scope,
    window: 'primary',
    scope,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMinutes: scope === 'five-hour' ? 300 : 10_080,
    resetsAt: scope === 'five-hour' ? '2026-09-04T15:00:00.000Z' : '2026-09-08T10:00:00.000Z',
    observedAt: OBSERVED_AT,
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}

function liveBudget(): BudgetReport {
  return {
    platform: {
      os: 'linux',
      osDisplayName: 'Linux',
      arch: 'x64',
      nodeVersion: '22.13.0',
      isWsl: false,
    },
    observedAt: OBSERVED_AT,
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'observed',
        windows: [usageWindow(CLAUDE, 'five-hour', 70), usageWindow(CLAUDE, 'weekly', 60)],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
      {
        harnessId: CODEX,
        state: 'observed',
        windows: [usageWindow(CODEX, 'five-hour', 20), usageWindow(CODEX, 'weekly', 20)],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
    ],
  };
}

function qualityReceipt(benchmarkId: string, quality: TaskQualityGate): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    variant: 'baseline',
    taskClass: 'hard',
    harnessId: CODEX,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T12:00:00.000Z',
    completedAt: '2026-09-04T12:05:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: null,
    outcome: {
      qualityGate: quality,
      attempts: 1,
      failedAttempts: quality === 'failed' ? 1 : 0,
      errorCodes: [],
    },
  };
}

function transferReceipt(
  benchmarkId: string,
  benefit: CrossHarnessTransferReceipt['benefit'],
  overrides: Partial<CrossHarnessTransferReceipt> = {},
): CrossHarnessTransferReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    projectId: 'p_current',
    taskClass: 'hard',
    currentHarness: CLAUDE,
    candidateHarness: CODEX,
    handoffBytes: 333,
    handoffDigest: digestText(`# ${benchmarkId}`),
    maxHandoffBytes: 1024,
    benefit,
    basis: benefit === 'non-positive' ? 'handoff-budget' : 'quality',
    reasons: ['fixture transfer evidence'],
    recordedAt: '2026-09-05T04:00:00.000Z',
    ...overrides,
  };
}

describe('schedule CLI', () => {
  it('returns insufficient evidence instead of inventing a switch', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams);

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /recommendation: insufficient-evidence/);
    assert.match(output.stdout(), /current-quota-unknown/);
    assert.match(output.stdout(), /Budget evidence: not-configured/);
    assert.match(output.stdout(), /Quality evidence: not-configured/);
    assert.match(output.stdout(), /Transfer evidence: not-configured/);
  });

  it('hydrates unknown pace fields from injected live budget evidence', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams, {
      observeBudget: async () => liveBudget(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /Budget evidence: observed/);
    assert.match(output.stdout(), /current five-hour: over-pace/);
    assert.match(output.stdout(), /candidate five-hour: under-pace/);
    assert.match(output.stdout(), /candidate-quality-unknown/);
    assert.doesNotMatch(output.stdout(), /current-quota-unknown/);
  });

  it('hydrates candidate quality from local project receipts', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams, {
      observeBudget: async () => liveBudget(),
      observeQualityReceipts: async () => [
        qualityReceipt('hard-a', 'passed'),
        qualityReceipt('hard-b', 'passed'),
      ],
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /Quality evidence: observed/);
    assert.match(output.stdout(), /state: passed/);
    assert.match(output.stdout(), /samples: 2/);
    assert.match(output.stdout(), /benchmark-quality-passed/);
    assert.match(output.stdout(), /transfer-benefit-unknown/);
    assert.doesNotMatch(output.stdout(), /candidate-quality-unknown/);
  });

  it('hydrates unanimous project transfer receipts and can complete the switch decision', async () => {
    const output = capture();
    const exitCode = await scheduleMain([...base, '--handoff-bytes', '700'], output.streams, {
      observeBudget: async () => liveBudget(),
      observeQualityReceipts: async () => [qualityReceipt('quality-a', 'passed')],
      observeTransferReceipts: async () => [
        transferReceipt('transfer-a', 'proven-positive'),
        transferReceipt('transfer-b', 'proven-positive'),
      ],
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /recommendation: switch/);
    assert.match(output.stdout(), /Transfer evidence: observed/);
    assert.match(output.stdout(), /benefit: proven-positive/);
    assert.match(output.stdout(), /handoff bytes: 700/);
    assert.match(output.stdout(), /max handoff bytes: 2048/);
    assert.match(output.stdout(), /transfer-evidence-positive/);
    assert.match(output.stdout(), /transfer-benefit-positive/);
  });

  it('keeps transfer benefit unknown when attributable receipts include uncertainty', async () => {
    const output = capture();
    const exitCode = await scheduleMain([...base, '--handoff-bytes', '700'], output.streams, {
      observeBudget: async () => liveBudget(),
      observeQualityReceipts: async () => [qualityReceipt('quality-a', 'passed')],
      observeTransferReceipts: async () => [
        transferReceipt('transfer-a', 'proven-positive'),
        transferReceipt('transfer-b', 'unknown'),
      ],
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /recommendation: insufficient-evidence/);
    assert.match(output.stdout(), /Transfer evidence: inconclusive/);
    assert.match(output.stdout(), /benefit: unknown/);
    assert.match(output.stdout(), /transfer-evidence-inconclusive/);
    assert.match(output.stdout(), /transfer-benefit-unknown/);
  });

  it('keeps conflicting local quality observations unknown', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams, {
      observeBudget: async () => liveBudget(),
      observeQualityReceipts: async () => [
        qualityReceipt('hard-a', 'passed'),
        qualityReceipt('hard-b', 'failed'),
      ],
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /Quality evidence: conflicting/);
    assert.match(output.stdout(), /state: unknown/);
    assert.match(output.stdout(), /samples: 2/);
    assert.match(output.stdout(), /benchmark-quality-conflicting/);
    assert.match(output.stdout(), /candidate-quality-unknown/);
  });

  it('preserves explicit pace while hydrating only unknown fields', async () => {
    const output = capture();
    let observations = 0;
    const exitCode = await scheduleMain(
      [...base, '--current-five-hour', 'on-pace'],
      output.streams,
      {
        observeBudget: async () => {
          observations += 1;
          return liveBudget();
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(observations, 1);
    assert.match(output.stdout(), /current five-hour: on-pace/);
    assert.match(output.stdout(), /current weekly: over-pace/);
    assert.match(output.stdout(), /explicit-pace-preserved/);
  });

  it('does not override explicitly supplied unknown quality', async () => {
    const output = capture();
    let observations = 0;
    const exitCode = await scheduleMain(
      [...base, '--candidate-quality', 'unknown'],
      output.streams,
      {
        observeBudget: async () => liveBudget(),
        observeQualityReceipts: async () => {
          observations += 1;
          return [qualityReceipt('hard-a', 'passed')];
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(observations, 0);
    assert.match(output.stdout(), /Quality evidence: not-needed/);
    assert.match(output.stdout(), /state: unknown/);
    assert.match(output.stdout(), /candidate-quality-unknown/);
  });

  it('does not override an explicitly supplied unknown transfer verdict', async () => {
    const output = capture();
    let observations = 0;
    const exitCode = await scheduleMain(
      [...base, '--transfer-benefit', 'unknown'],
      output.streams,
      {
        observeTransferReceipts: async () => {
          observations += 1;
          return [transferReceipt('transfer-a', 'proven-positive')];
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(observations, 0);
    assert.match(output.stdout(), /Transfer evidence: not-needed/);
    assert.match(output.stdout(), /benefit: unknown/);
  });

  it('keeps unknown pace when live budget observation fails', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams, {
      observeBudget: async () => {
        throw new Error('fixture failure');
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /Budget evidence: failed/);
    assert.match(output.stdout(), /current five-hour: unknown/);
    assert.match(output.stdout(), /current-quota-unknown/);
  });

  it('keeps quality unknown when receipt observation fails', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams, {
      observeBudget: async () => liveBudget(),
      observeQualityReceipts: async () => {
        throw new Error('fixture failure');
      },
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /Quality evidence: failed/);
    assert.match(output.stdout(), /state: unknown/);
    assert.match(output.stdout(), /candidate-quality-unknown/);
  });

  it('keeps transfer benefit unknown when receipt observation fails', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams, {
      observeTransferReceipts: async () => {
        throw new Error('fixture failure');
      },
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /Transfer evidence: failed/);
    assert.match(output.stdout(), /benefit: unknown/);
  });

  it('recommends switching only with fully positive explicit evidence', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [
        ...base,
        '--current-five-hour',
        'over-pace',
        '--current-weekly',
        'on-pace',
        '--candidate-five-hour',
        'under-pace',
        '--candidate-weekly',
        'on-pace',
        '--candidate-quality',
        'passed',
        '--candidate-quality-task',
        'hard',
        '--candidate-quality-samples',
        '3',
        '--handoff-bytes',
        '900',
        '--transfer-benefit',
        'proven-positive',
      ],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /recommendation: switch/);
    assert.match(output.stdout(), /Budget evidence: not-needed/);
    assert.match(output.stdout(), /Quality evidence: not-needed/);
    assert.match(output.stdout(), /Transfer evidence: not-needed/);
    assert.match(output.stdout(), /transfer-benefit-positive/);
  });

  it('stays when transfer evidence says the handoff is not worth it', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [
        ...base,
        '--current-five-hour',
        'over-pace',
        '--current-weekly',
        'on-pace',
        '--candidate-five-hour',
        'under-pace',
        '--candidate-weekly',
        'on-pace',
        '--candidate-quality',
        'passed',
        '--candidate-quality-task',
        'hard',
        '--candidate-quality-samples',
        '2',
        '--handoff-bytes',
        '900',
        '--transfer-benefit',
        'non-positive',
      ],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /recommendation: stay/);
    assert.match(output.stdout(), /transfer-cost-not-worth-it/);
  });

  it('keeps quota, quality, and transfer evidence machine-readable in the standard envelope', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [...base, '--handoff-bytes', '700', '--json'],
      output.streams,
      {
        observeBudget: async () => liveBudget(),
        observeQualityReceipts: async () => [qualityReceipt('hard-a', 'passed')],
        observeTransferReceipts: async () => [transferReceipt('transfer-a', 'proven-positive')],
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      command: string;
      status: string;
      data: {
        decision: string;
        currentHarness: string;
        candidateHarness: string;
        evidence: {
          current: { fiveHourPace: string };
          candidate: { fiveHourPace: string; quality: string; qualitySamples: number };
          transfer: { benefit: string; handoffBytes: number; maxHandoffBytes: number };
        };
        budgetEvidence: { status: string };
        qualityEvidence: { status: string };
        transferEvidence: { status: string };
      };
    };
    assert.equal(envelope.command, 'schedule');
    assert.equal(envelope.status, 'ok');
    assert.equal(envelope.data.decision, 'switch');
    assert.equal(envelope.data.currentHarness, 'claude');
    assert.equal(envelope.data.candidateHarness, 'codex');
    assert.equal(envelope.data.evidence.current.fiveHourPace, 'over-pace');
    assert.equal(envelope.data.evidence.candidate.fiveHourPace, 'under-pace');
    assert.equal(envelope.data.evidence.candidate.quality, 'passed');
    assert.equal(envelope.data.evidence.candidate.qualitySamples, 1);
    assert.equal(envelope.data.evidence.transfer.benefit, 'proven-positive');
    assert.equal(envelope.data.evidence.transfer.handoffBytes, 700);
    assert.equal(envelope.data.evidence.transfer.maxHandoffBytes, 2048);
    assert.equal(envelope.data.budgetEvidence.status, 'observed');
    assert.equal(envelope.data.qualityEvidence.status, 'observed');
    assert.equal(envelope.data.transferEvidence.status, 'observed');
  });

  it('rejects malformed evidence as usage errors', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [...base, '--candidate-quality-samples', '1.5'],
      output.streams,
    );

    assert.equal(exitCode, 2);
    assert.match(output.stderr(), /invalid-schedule-number/);
  });

  it('lets help/version win over invalid arguments without observing evidence', async () => {
    let budgetObservations = 0;
    let qualityObservations = 0;
    let transferObservations = 0;
    const runtime = {
      observeBudget: async () => {
        budgetObservations += 1;
        return liveBudget();
      },
      observeQualityReceipts: async () => {
        qualityObservations += 1;
        return [qualityReceipt('hard-a', 'passed')];
      },
      observeTransferReceipts: async () => {
        transferObservations += 1;
        return [transferReceipt('transfer-a', 'proven-positive')];
      },
    };
    const help = capture();
    assert.equal(await scheduleMain(['--bad', '--help'], help.streams, runtime), 0);
    assert.equal(help.stderr(), '');
    assert.match(help.stdout(), /token-harness schedule/);

    const version = capture();
    assert.equal(await scheduleMain(['--bad', '--version'], version.streams, runtime), 0);
    assert.equal(version.stderr(), '');
    assert.match(version.stdout(), /^0\.1\.5\n$/);
    assert.equal(budgetObservations, 0);
    assert.equal(qualityObservations, 0);
    assert.equal(transferObservations, 0);
  });
});

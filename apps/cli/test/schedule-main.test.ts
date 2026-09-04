import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type BudgetReport,
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

describe('schedule CLI', () => {
  it('returns insufficient evidence instead of inventing a switch', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams);

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /recommendation: insufficient-evidence/);
    assert.match(output.stdout(), /current-quota-unknown/);
    assert.match(output.stdout(), /Budget evidence: not-configured/);
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

  it('recommends switching only with fully positive evidence', async () => {
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

  it('keeps the decision machine-readable in the standard envelope', async () => {
    const output = capture();
    const exitCode = await scheduleMain([...base, '--json'], output.streams, {
      observeBudget: async () => liveBudget(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      command: string;
      status: string;
      data: {
        decision: string;
        currentHarness: string;
        candidateHarness: string;
        evidence: { current: { fiveHourPace: string }; candidate: { fiveHourPace: string } };
        budgetEvidence: { status: string };
      };
    };
    assert.equal(envelope.command, 'schedule');
    assert.equal(envelope.status, 'ok');
    assert.equal(envelope.data.decision, 'insufficient-evidence');
    assert.equal(envelope.data.currentHarness, 'claude');
    assert.equal(envelope.data.candidateHarness, 'codex');
    assert.equal(envelope.data.evidence.current.fiveHourPace, 'over-pace');
    assert.equal(envelope.data.evidence.candidate.fiveHourPace, 'under-pace');
    assert.equal(envelope.data.budgetEvidence.status, 'observed');
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

  it('lets help/version win over invalid arguments without observing budget', async () => {
    let observations = 0;
    const runtime = {
      observeBudget: async () => {
        observations += 1;
        return liveBudget();
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
    assert.equal(observations, 0);
  });
});

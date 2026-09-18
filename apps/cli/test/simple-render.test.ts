import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXIT_CODES,
  commandResult,
  type DoctorReport,
  type ApplyReport,
  type PlatformFacts,
  type UpdateReport,
} from '@token-harness/core';

import { renderHuman } from '../src/render/index.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

const REPORT: DoctorReport = {
  platform: PLATFORM,
  harnesses: [],
  providers: [],
  problemCount: 0,
};

describe('progressive human rendering', () => {
  it('states changes and ends with exactly one next step', () => {
    const result = commandResult({ command: 'doctor', exitCode: EXIT_CODES.ok, data: REPORT });
    const output = renderHuman(result, {
      toolVersion: '0.1.6',
      home: '/home/dev',
      decorate: false,
    }).report;

    assert.match(output, /CHANGES\n {2}Nothing changed\./);
    assert.equal(output.match(/NEXT STEP/g)?.length, 1);
    assert.match(output, /token-harness setup/);
  });

  it('keeps a rejected stored plan id in the safe inspection command', () => {
    const report: ApplyReport = {
      planId: '3ebed6d6',
      transactionId: null,
      fromStoredPlan: true,
      outcome: 'rejected',
      results: [],
      unrestored: [],
      receiptId: null,
    };
    const output = renderHuman(
      commandResult({
        command: 'apply',
        exitCode: EXIT_CODES['precondition-drift'],
        data: report,
      }),
      { toolVersion: '0.1.8', home: '/home/dev', decorate: false },
    ).report;
    assert.match(output, /token-harness apply --plan 3ebed6d6 --verbose/);
    assert.doesNotMatch(output, /--yes/);
  });

  it('does not ask for a redundant verify when apply already verified the requested state', () => {
    const report: ApplyReport = {
      planId: null,
      transactionId: 'candidate-apply',
      fromStoredPlan: false,
      outcome: 'committed',
      results: [{ actionId: 'candidate', kind: 'managed-change', status: 'applied', path: null }],
      unrestored: [],
      receiptId: null,
      requestedStateVerified: true,
    };
    const output = renderHuman(
      commandResult({ command: 'apply', exitCode: EXIT_CODES.ok, data: report }),
      { toolVersion: '0.1.11', home: '/home/dev', decorate: false },
    ).report;

    assert.equal(output.match(/NEXT STEP/g)?.length, 1);
    assert.doesNotMatch(output, /token-harness verify/);
    assert.match(output, /requested state is already verified/i);
  });

  it('does not ask for a redundant verify when uninstall already verified the requested state', () => {
    const report: ApplyReport = {
      planId: null,
      transactionId: 'candidate-uninstall',
      fromStoredPlan: false,
      outcome: 'committed',
      results: [{ actionId: 'candidate', kind: 'managed-change', status: 'applied', path: null }],
      unrestored: [],
      receiptId: null,
      requestedStateVerified: true,
    };
    const output = renderHuman(
      commandResult({ command: 'uninstall', exitCode: EXIT_CODES.ok, data: report }),
      { toolVersion: '0.1.11', home: '/home/dev', decorate: false },
    ).report;

    assert.doesNotMatch(output, /token-harness verify/);
    assert.match(output, /requested state is already verified/i);
  });

  it('keeps verify as the next step when successful apply did not verify integration state', () => {
    const report: ApplyReport = {
      planId: 'verified-later',
      transactionId: 'normal-apply',
      fromStoredPlan: true,
      outcome: 'committed',
      results: [{ actionId: 'provider', kind: 'managed-change', status: 'applied', path: null }],
      unrestored: [],
      receiptId: 'normal-apply',
    };
    const output = renderHuman(
      commandResult({ command: 'apply', exitCode: EXIT_CODES.ok, data: report }),
      { toolVersion: '0.1.11', home: '/home/dev', decorate: false },
    ).report;

    assert.match(output, /token-harness verify/);
  });

  it('prints the exact confirmation command when a provider update is ready', () => {
    const report: UpdateReport = {
      providers: [
        {
          providerId: 'rtk' as UpdateReport['providers'][number]['providerId'],
          installed: '0.44.0',
          available: '0.45.0',
          channel: 'cargo',
          verdict: 'upgradable',
          pin: null,
        },
      ],
      network: ['crates.io'],
      execution: {
        planId: null,
        transactionId: null,
        fromStoredPlan: false,
        outcome: 'confirmation-required',
        results: [],
        unrestored: [],
        receiptId: null,
      },
    };
    const output = renderHuman(
      commandResult({
        command: 'update',
        exitCode: EXIT_CODES['confirmation-required'],
        data: report,
      }),
      { toolVersion: '0.1.12', home: '/home/dev', decorate: false },
    ).report;

    assert.equal(output.match(/NEXT STEP/g)?.length, 1);
    assert.match(output, /token-harness update --yes/);
    assert.match(output, /Apply the reviewed provider update/);
  });

  it('keeps the established technical report behind --verbose', () => {
    const result = commandResult({ command: 'doctor', exitCode: EXIT_CODES.ok, data: REPORT });
    const output = renderHuman(result, {
      toolVersion: '0.1.6',
      home: '/home/dev',
      decorate: false,
      verbose: true,
    }).report;

    assert.match(output, /^Token Harness 0\.1\.6/);
    assert.doesNotMatch(output, /^TOKEN HARNESS -/);
  });
});

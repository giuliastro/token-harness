import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXIT_CODES,
  commandResult,
  type DoctorReport,
  type ApplyReport,
  type PlatformFacts,
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

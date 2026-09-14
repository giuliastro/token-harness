import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPATIBILITY_ROWS,
  admitManagedMutation,
  harnessId,
  providerId,
} from '../src/index.js';

describe('GitNexus RFC 0009 compatibility row', () => {
  it('admits only the exact recorded Claude 2.1.269 × GitNexus 1.6.12 × Linux tuple', () => {
    const exact = admitManagedMutation(COMPATIBILITY_ROWS, {
      provider: providerId('gitnexus'),
      providerVersion: '1.6.12',
      harness: harnessId('claude'),
      harnessVersion: '2.1.269',
      os: 'linux',
      wsl: false,
    });
    assert.equal(exact.state, 'admitted');
    if (exact.state === 'admitted') {
      assert.equal(exact.row.configSchema, 'claude-user-json-mcp-entry');
      assert.equal(
        exact.row.fixture,
        'tests/fixtures/rows/gitnexus-claude-linux-2.1.269-1.6.12',
      );
      assert.equal(exact.row.verificationTier, 'config-only');
    }

    for (const variant of [
      {
        harnessVersion: '2.1.268',
        providerVersion: '1.6.12',
        os: 'linux',
        wsl: false,
      },
      {
        harnessVersion: '2.1.270',
        providerVersion: '1.6.12',
        os: 'linux',
        wsl: false,
      },
      {
        harnessVersion: '2.1.269',
        providerVersion: '1.6.11',
        os: 'linux',
        wsl: false,
      },
      {
        harnessVersion: '2.1.269',
        providerVersion: '1.6.13',
        os: 'linux',
        wsl: false,
      },
      {
        harnessVersion: '2.1.269',
        providerVersion: '1.6.12',
        os: 'linux',
        wsl: true,
      },
      {
        harnessVersion: '2.1.269',
        providerVersion: '1.6.12',
        os: 'windows',
        wsl: false,
      },
      {
        harnessVersion: '2.1.269',
        providerVersion: '1.6.12',
        os: 'macos',
        wsl: false,
      },
    ] as const) {
      const outcome = admitManagedMutation(COMPATIBILITY_ROWS, {
        provider: providerId('gitnexus'),
        providerVersion: variant.providerVersion,
        harness: harnessId('claude'),
        harnessVersion: variant.harnessVersion,
        os: variant.os,
        wsl: variant.wsl,
      });
      assert.equal(outcome.state, 'refused');
    }
  });
});

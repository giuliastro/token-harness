import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';

import {
  commandResult,
  harnessId,
  providerId,
  toEnvelope,
  type CliEnvelope,
  type DoctorReport,
  type UpdateReport,
} from '@token-harness/core';
import { GuideService, type GuideCall, type GuideOverview } from '../src/guided.js';
import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { createGuideHandler } from '../src/guided-http.js';

const platform = {
  os: 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
} as const;
const CLAUDE = harnessId('claude');
const RTK = providerId('rtk');

function envelope<T>(command: string, data: T): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}

it('checks updates only on demand, keeps the period cache hot, and expires evidence on version drift', async () => {
  const calls: string[][] = [];
  let providerVersion = '0.44.0';
  const doctor = (): DoctorReport => ({
    platform,
    problemCount: 0,
    providers: [
      {
        providerId: RTK,
        state: 'configured',
        version: providerVersion,
        executable: '/tools/rtk',
        installationChannel: 'cargo',
        versionVerdict: 'in-range',
        configuredHarnesses: [CLAUDE],
        unmanagedHarnessesConfigured: [],
        supportsUnmanagedHarnesses: false,
        managedByTokenHarness: false,
        assignableHarnesses: [CLAUDE],
        evidence: [],
        warnings: [],
      },
    ],
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'configured',
        version: '2.1.261',
        versionVerdict: 'in-range',
        configPath: null,
        declaredVerificationTier: 'config-only',
        evidence: [],
        warnings: [],
      },
    ],
  });
  const update = (): UpdateReport => ({
    providers: [
      {
        providerId: RTK,
        installed: providerVersion,
        available: '0.45.0',
        channel: 'cargo',
        verdict: providerVersion === '0.44.0' ? 'upgradable' : 'current',
        pin: null,
      },
    ],
    network: ['crates.io'],
    execution: {
      planId: null,
      transactionId: null,
      fromStoredPlan: false,
      outcome: providerVersion === '0.44.0' ? 'confirmation-required' : 'nothing-to-do',
      results: [],
      unrestored: [],
      receiptId: null,
    },
  });
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor() as T);
    if (command === 'update') return envelope(command, update() as T);
    return envelope(command, null as T);
  };

  const service = new GuideService(
    call,
    () => 0,
    () => 'ticket',
  );
  const token = 'a'.repeat(64);
  let authority = '';
  const server = createServer(createGuideHandler({ service, token, authority: () => authority }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = `127.0.0.1:${address.port}`;
  const origin = `http://${authority}`;

  try {
    const first = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(first.status, 200);
    const initial = (await first.json()) as GuideOverview;
    assert.equal(initial.stack.components[0]?.update, 'not-checked');
    assert.equal(
      calls.filter((args) => args[0] === 'update').length,
      0,
      'opening the UI must not poll update channels',
    );
    const afterOverview = calls.length;

    const checked = await fetch(`${origin}/api/update-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: JSON.stringify({ period: 'all' }),
    });
    assert.equal(checked.status, 200);
    const result = (await checked.json()) as { ok: boolean; stack?: GuideOverview['stack'] };
    assert.equal(result.ok, true);
    assert.equal(result.stack?.components[0]?.update, 'available');
    assert.equal(result.stack?.components[0]?.updateAvailableVersion, '0.45.0');
    assert.deepEqual(
      calls.filter((args) => args[0] === 'update'),
      [['update']],
    );
    assert.ok(
      calls.every((args) => !args.includes('--yes')),
      'the dashboard check must never request confirmation',
    );
    const afterCheck = calls.length;
    assert.ok(afterCheck > afterOverview);

    const cached = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(cached.status, 200);
    const cachedOverview = (await cached.json()) as GuideOverview;
    assert.equal(cachedOverview.stack.components[0]?.update, 'available');
    assert.equal(
      calls.length,
      afterCheck,
      'reading the checked stack must not reload allowance, context, or metrics',
    );

    providerVersion = '0.45.0';
    const refreshed = await fetch(`${origin}/api/overview?period=all&refresh=1`);
    assert.equal(refreshed.status, 200);
    const changed = (await refreshed.json()) as GuideOverview;
    assert.equal(changed.stack.components[0]?.version, '0.45.0');
    assert.equal(
      changed.stack.components[0]?.update,
      'not-checked',
      'update evidence must expire when the stack fingerprint changes',
    );
    assert.equal(
      calls.filter((args) => args[0] === 'update').length,
      1,
      'refresh must not silently recheck channels',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('exposes one explicit read-only update check in maintenance', () => {
  assert.match(GUIDE_HTML, /Checks and maintenance/);
  assert.match(GUIDE_JS, /Check optimizer updates/);
  assert.match(GUIDE_JS, /Check updates/);
  assert.match(GUIDE_JS, /\/api\/update-check/);
  assert.match(GUIDE_JS, /does not download or upgrade anything/);
  assert.doesNotMatch(GUIDE_JS, /update-check[^\n]+--yes/);
});

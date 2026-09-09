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
  type VerifyReport,
} from '@token-harness/core';
import { GuideService, type GuideCall, type GuideOverview } from '../src/guided.js';
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
  const result = commandResult({ command, data, exitCode: 0 });
  return toEnvelope(result, 'test');
}

it('updates verified stack evidence without reloading the full overview', async () => {
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

  const verified: VerifyReport = {
    receiptId: null,
    appliedAt: null,
    healthyAtDeclaredTier: true,
    results: [
      {
        providerId: RTK,
        harnessId: CLAUDE,
        status: 'healthy',
        declaredTier: 'config-only',
        managedByTokenHarness: false,
        checks: [],
      },
    ],
  };
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor() as T);
    if (command === 'verify') return envelope(command, verified as T);
    return envelope(command, null as T);
  };

  const service = new GuideService(
    call,
    () => 0,
    () => 'ticket',
  );
  const token = 'a'.repeat(64);
  let authority = '';
  const handler = createGuideHandler({
    service,
    token,
    authority: () => authority,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = `127.0.0.1:${address.port}`;
  const origin = `http://${authority}`;

  try {
    const first = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(first.status, 200);
    const initial = (await first.json()) as GuideOverview;
    assert.equal(initial.stack.components[0]?.verification, 'not-checked');
    const afterOverview = calls.length;
    assert.ok(afterOverview > 0);

    const verification = await fetch(`${origin}/api/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: '{}',
    });
    assert.equal(verification.status, 200);
    const verificationBody = (await verification.json()) as { stack?: GuideOverview['stack'] };
    assert.equal(verificationBody.stack?.components[0]?.verification, 'verified');
    const afterVerify = calls.length;
    assert.ok(afterVerify > afterOverview);

    const cached = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(cached.status, 200);
    const cachedOverview = (await cached.json()) as GuideOverview;
    assert.equal(cachedOverview.stack.components[0]?.verification, 'verified');
    assert.equal(
      calls.length,
      afterVerify,
      'verification must update stack evidence without repeating allowance/context/metrics reads',
    );

    providerVersion = '0.45.0';
    const refreshed = await fetch(`${origin}/api/overview?period=all&refresh=1`);
    assert.equal(refreshed.status, 200);
    const refreshedOverview = (await refreshed.json()) as GuideOverview;
    assert.ok(calls.length > afterVerify, 'explicit refresh must collect fresh evidence');
    assert.equal(refreshedOverview.stack.components[0]?.version, '0.45.0');
    assert.equal(
      refreshedOverview.stack.components[0]?.verification,
      'not-checked',
      'verification from the previous provider version must not be reused after drift',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';

import {
  commandResult,
  harnessId,
  toEnvelope,
  type CliEnvelope,
  type DoctorReport,
} from '@token-harness/core';
import { GuideService, type GuideCall } from '../src/guided.js';
import { createGuideHandler } from '../src/guided-http.js';

const platform = {
  os: 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
} as const;

function envelope<T>(command: string, data: T): CliEnvelope<T> {
  const result = commandResult({ command, data, exitCode: 0 });
  return toEnvelope(result, 'test');
}

it('keeps overview cache hot after read-only verification', async () => {
  const calls: string[][] = [];
  const doctor: DoctorReport = {
    platform,
    problemCount: 0,
    providers: [],
    harnesses: [
      {
        harnessId: harnessId('claude'),
        state: 'configured',
        version: '2.1.261',
        versionVerdict: 'in-range',
        configPath: null,
        declaredVerificationTier: 'config-only',
        evidence: [],
        warnings: [],
      },
    ],
  };

  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor as T);
    if (command === 'verify') {
      const report = {
        receiptId: null,
        appliedAt: null,
        results: [],
        healthyAtDeclaredTier: true,
      };
      return envelope(command, report as T);
    }
    return envelope(command, null as T);
  };

  const service = new GuideService(call, () => 0, () => 'ticket');
  const token = 'a'.repeat(64);
  let authority = '';
  const handler = createGuideHandler({
    service,
    token,
    authority: () => authority,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = `127.0.0.1:${address.port}`;
  const origin = `http://${authority}`;

  try {
    const first = await fetch(`${origin}/api/overview`);
    assert.equal(first.status, 200);
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
    const afterVerify = calls.length;
    assert.ok(afterVerify > afterOverview);

    const cached = await fetch(`${origin}/api/overview`);
    assert.equal(cached.status, 200);
    assert.equal(calls.length, afterVerify);

    const refreshed = await fetch(`${origin}/api/overview?refresh=1`);
    assert.equal(refreshed.status, 200);
    assert.ok(calls.length > afterVerify);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

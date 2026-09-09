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
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}

it('read-only integration verification keeps the current overview cache hot', async () => {
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
    const data =
      command === 'doctor'
        ? doctor
        : command === 'verify'
          ? {
              receiptId: null,
              appliedAt: null,
              results: [],
              healthyAtDeclaredTier: true,
            }
          : null;
    return envelope(command, data as T);
  };
  const service = new GuideService(call, () => 0, () => 'ticket');
  const token = 'a'.repeat(64);
  let authority = '';
  const server = createServer(
    createGuideHandler({ service, token, authority: () => authority }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = `127.0.0.1:${address.port}`;
  const origin = `http://${authority}`;

  try {
    assert.equal((await fetch(`${origin}/api/overview`)).status, 200);
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
    assert.ok(
      afterVerify > afterOverview,
      'verification itself should still run its read-only checks',
    );

    assert.equal((await fetch(`${origin}/api/overview`)).status, 200);
    assert.equal(
      calls.length,
      afterVerify,
      'opening the overview after verification must not repeat the full collection',
    );

    assert.equal((await fetch(`${origin}/api/overview?refresh=1`)).status, 200);
    assert.ok(
      calls.length > afterVerify,
      'an explicit refresh must still collect fresh evidence',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

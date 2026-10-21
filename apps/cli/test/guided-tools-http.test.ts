import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';
import { commandResult, toEnvelope } from '@token-harness/core';
import { GuideError, GuideService, type GuideCall } from '../src/guided.js';
import { createGuideHandler } from '../src/guided-http.js';

it('shares the session mutation slot between experiment controllers and ordinary setup', async () => {
  const call: GuideCall = async <T>(args: readonly string[]) =>
    toEnvelope(commandResult({ command: args[0]!, exitCode: 0, data: null as T }), 'test');
  const service = new GuideService(
    call,
    () => 0,
    () => 'ticket',
  );
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const operation = service.experimentOperation(async () => {
    entered();
    await gate;
  });
  await ready;
  assert.equal(service.status().busy, true);
  await assert.rejects(
    service.preview({ action: 'setup' }),
    (error: unknown) => error instanceof GuideError && error.status === 409,
  );
  release();
  await operation;
  assert.equal(service.status().busy, false);
});

it('requires the existing same-origin session approval boundary for advanced and experiment routes', async () => {
  const call: GuideCall = async <T>(args: readonly string[]) =>
    toEnvelope(commandResult({ command: args[0]!, exitCode: 0, data: null as T }), 'test');
  let calls = 0,
    authority = '';
  const service = new GuideService(
    call,
    () => 0,
    () => 'ticket',
  );
  const server = createServer(
    createGuideHandler({
      service,
      token: 'secret',
      authority: () => authority,
      tools: async () => {
        calls++;
        return { ok: true };
      },
      experiments: async () => {
        calls++;
        return { ok: true };
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = '127.0.0.1:' + address.port;
  const origin = 'http://' + authority;
  try {
    for (const route of ['/api/tools', '/api/experiments']) {
      assert.equal(
        (
          await fetch(origin + route, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: '{}',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(origin + route, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://untrusted.example',
              'x-token-harness-csrf': 'secret',
            },
            body: '{}',
          })
        ).status,
        403,
      );
      assert.equal(calls, 0);
      assert.equal(
        (
          await fetch(origin + route, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: origin,
              'x-token-harness-csrf': 'secret',
            },
            body: '{}',
          })
        ).status,
        200,
      );
      calls = 0;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

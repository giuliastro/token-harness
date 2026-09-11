import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';
import { GUIDE_JS } from '../src/guided-assets.js';
import { createGuideHandler } from '../src/guided-http.js';
import { createGuideSavingsReader } from '../src/guided-savings-reader.js';
import {
  savingsView,
  type GuideCall,
  type GuidePeriod,
  type GuideService,
} from '../src/guided.js';

describe('guided results period reads', () => {
  it('runs only the savings command for a new results window', async () => {
    const calls: string[][] = [];
    const call: GuideCall = async <T>(args: readonly string[]) => {
      calls.push([...args]);
      return toEnvelope(
        commandResult({ command: 'savings', data: null, exitCode: 0 }),
        'test',
      ) as CliEnvelope<T>;
    };
    const readSavings = createGuideSavingsReader(call);

    const result = await readSavings('7d');

    assert.equal(result.period, '7d');
    assert.deepEqual(result.rows, []);
    assert.deepEqual(calls, [['savings', '--since', '7d']]);
    assert.ok(calls.every(([command]) => command !== 'doctor'));
    assert.ok(calls.every(([command]) => command !== 'budget'));
    assert.ok(calls.every(([command]) => command !== 'context'));
    assert.ok(calls.every(([command]) => command !== 'status'));
    assert.ok(calls.every(([command]) => command !== 'benchmark-matrix'));
  });

  it('exposes a same-origin savings-only endpoint with strict period validation', async () => {
    let authority = '';
    const requested: GuidePeriod[] = [];
    const service = { status: () => ({}) } as unknown as GuideService;
    const server = createServer(
      createGuideHandler({
        service,
        token: 'a'.repeat(64),
        authority: () => authority,
        readSavings: async (period) => {
          requested.push(period);
          return savingsView(null, period);
        },
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    authority = '127.0.0.1:' + address.port;
    const origin = 'http://' + authority;
    try {
      const response = await fetch(origin + '/api/savings?period=30d');
      assert.equal(response.status, 200);
      const body = (await response.json()) as { savings: { period: string } };
      assert.equal(body.savings.period, '30d');
      assert.deepEqual(requested, ['30d']);

      const invalid = await fetch(origin + '/api/savings?period=wrong');
      assert.equal(invalid.status, 400);
      assert.deepEqual(requested, ['30d']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('routes only period changes away from the full overview read', () => {
    assert.match(GUIDE_JS, /periodReading/);
    assert.match(GUIDE_JS, /\/api\/savings\?/);
    assert.match(GUIDE_JS, /path\.startsWith\('\/api\/overview\?period='\)/);
    assert.match(GUIDE_JS, /!path\.includes\('refresh=1'\)/);
  });
});

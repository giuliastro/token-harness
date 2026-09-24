import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CcrManagementClient,
  CcrManagementError,
  addCcrSmartRoutingRule,
  createCcrSmartRoutingRule,
  isExactCcrSmartRoutingRule,
  isSameCcrConfig,
  reduceCcrSessionUsage,
  removeOwnedCcrSmartRoutingRule,
  resolveCcrManagementUrl,
} from '../src/routing/ccr-management.js';

describe('CCR management adapter', () => {
  it('only accepts local URLs before an auth token can be sent', () => {
    assert.equal(resolveCcrManagementUrl(undefined), 'http://127.0.0.1:3458');
    assert.equal(resolveCcrManagementUrl('http://localhost:3458'), 'http://localhost:3458');
    assert.equal(resolveCcrManagementUrl('https://example.com:3458'), null);
    assert.equal(resolveCcrManagementUrl('http://127.0.0.1:3458/?ccr_web_token=secret'), null);
    assert.equal(resolveCcrManagementUrl('http://user:secret@127.0.0.1:3458'), null);
  });

  it('uses CCR RPC auth without exposing response errors or following redirects', async () => {
    let requestHeaders: Headers | undefined;
    let redirectMode: string | undefined;
    let requestUrl = '';
    const client = new CcrManagementClient({
      authToken: 'private-token',
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        redirectMode = init?.redirect;
        return new Response(JSON.stringify({ ok: true, value: { accepted: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.deepEqual(await client.call('getAppInfo'), { accepted: true });
    assert.equal(requestUrl, 'http://127.0.0.1:3458/api/ccr/rpc');
    assert.equal(requestHeaders?.get('x-ccr-web-auth'), 'private-token');
    assert.equal(redirectMode, 'error');

    const rejected = new CcrManagementClient({
      authToken: 'private-token',
      fetcher: async () =>
        new Response(JSON.stringify({ ok: false, error: { message: 'secret details' } }), {
          status: 401,
        }),
    });
    await assert.rejects(rejected.call('getConfig'), (error: unknown) => {
      assert.ok(error instanceof CcrManagementError);
      assert.equal(error.failure, 'unauthorized');
      assert.equal(error.message.includes('secret details'), false);
      return true;
    });
  });

  it('adds and removes only its own CCR routing rule', () => {
    const existing = { id: 'user-rule', type: 'condition', enabled: true };
    const config = {
      APIKEY: 'do-not-change',
      Router: { builtInRules: { codex: { enabled: true } }, rules: [existing] },
    };
    const rule = createCcrSmartRoutingRule('codex', '/state/routing/codex.js');
    const added = addCcrSmartRoutingRule(config, rule);
    assert.ok(added);
    assert.equal((added?.['Router'] as { rules: unknown[] }).rules[0], rule);
    assert.equal((added?.['Router'] as { rules: unknown[] }).rules[1], existing);
    assert.equal(added?.['APIKEY'], 'do-not-change');
    assert.equal(isExactCcrSmartRoutingRule(rule, { ...rule }), true);
    assert.equal(isSameCcrConfig(config, JSON.parse(JSON.stringify(config))), true);
    assert.equal(isSameCcrConfig(config, { ...config, APIKEY: 'changed' }), false);

    const removed = removeOwnedCcrSmartRoutingRule(added, String(rule['id']), rule);
    assert.deepEqual((removed?.['Router'] as { rules: unknown[] }).rules, [existing]);
    assert.equal(
      removeOwnedCcrSmartRoutingRule(added, String(rule['id']), { ...rule, enabled: false }),
      null,
    );
  });

  it('reduces session analysis to bounded in-window usage metadata', () => {
    const reduced = reduceCcrSessionUsage(
      {
        selectedSession: {
          session: { agent: 'codex', id: 'codex:session-1' },
          conversation: [{ user: { content: 'must-not-leave-adapter' } }],
          requests: [
            {
              sessionId: 'session-1',
              createdAt: '2026-09-24T10:00:00.000Z',
              model: 'OpenAI/gpt-fast',
              inputTokens: 50,
              outputTokens: 20,
              cacheReadTokens: 10,
              cacheWriteTokens: 2,
              totalTokens: 70,
              costUsd: 0.01,
              path: '/private/repo',
              userAgent: 'private-agent',
            },
            {
              sessionId: 'session-1',
              createdAt: '2026-09-23T10:00:00.000Z',
              model: 'OpenAI/gpt-old',
              inputTokens: 9,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 11,
            },
          ],
        },
      },
      'session-1',
      'codex',
      '2026-09-24T09:00:00.000Z',
      '2026-09-24T11:00:00.000Z',
    );
    assert.ok(reduced);
    assert.equal(reduced.requestCount, 1);
    assert.equal(reduced.totalTokens, 70);
    assert.equal(reduced.recordedCostUsd, 0.01);
    assert.deepEqual(Object.keys(reduced).sort(), [
      'byModel',
      'cacheReadTokens',
      'cacheWriteTokens',
      'inputTokens',
      'outputTokens',
      'recordedCostUsd',
      'requestCount',
      'sessionId',
      'totalTokens',
    ]);
    assert.equal(JSON.stringify(reduced).includes('must-not-leave-adapter'), false);
    assert.equal(JSON.stringify(reduced).includes('/private/repo'), false);
    assert.equal(JSON.stringify(reduced).includes('private-agent'), false);
    assert.equal(
      reduceCcrSessionUsage(
        {
          selectedSession: {
            session: { agent: 'codex', id: 'codex:session-1' },
            requests: [],
          },
        },
        'session-1',
        'claude-code',
        '2026-09-24T09:00:00.000Z',
        '2026-09-24T11:00:00.000Z',
      ),
      null,
    );

    assert.equal(
      reduceCcrSessionUsage(
        {
          selectedSession: {
            session: { agent: 'codex', id: 'codex:session-empty' },
            conversation: [],
            requests: [],
          },
        },
        'session-empty',
        'codex',
        '2026-09-24T09:00:00.000Z',
        '2026-09-24T11:00:00.000Z',
      ),
      null,
    );
    assert.equal(
      reduceCcrSessionUsage(
        {
          requestScanTruncated: true,
          selectedSession: {
            session: { agent: 'codex', id: 'codex:session-1' },
            requests: [],
          },
        },
        'session-1',
        'codex',
        '2026-09-24T09:00:00.000Z',
        '2026-09-24T11:00:00.000Z',
      ),
      null,
    );
  });
});

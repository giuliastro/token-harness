import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileSystemPort, SmartRoutingDecisionEvent } from '@token-harness/core';

import { runSmartRouting } from '../src/commands/smart-routing.js';
import type { CommandContext } from '../src/commands/context.js';

function memoryFileSystem(initial: Record<string, unknown> = {}) {
  const files = new Map<string, Uint8Array>();
  const directories = new Set(['/state', '/state/smart-routing']);
  for (const [path, value] of Object.entries(initial)) {
    files.set(path, new TextEncoder().encode(JSON.stringify(value)));
  }
  const fs: FileSystemPort = {
    join: (...segments) => segments.join('/').replace(/\/+/g, '/'),
    dirname: (path) => path.slice(0, path.lastIndexOf('/')) || '/',
    basename: (path) => path.slice(path.lastIndexOf('/') + 1),
    isInside: (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}/`),
    stat: async (path) =>
      files.has(path)
        ? { kind: 'file', byteLength: files.get(path)?.length ?? 0, mode: null }
        : null,
    canonicalPath: async (path) => path,
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    appendFile: async (path, content) => {
      const previous = files.get(path) ?? new Uint8Array();
      files.set(path, new Uint8Array([...previous, ...content]));
    },
    createDirectory: async (path) => {
      directories.add(path);
    },
    remove: async (path) => {
      files.delete(path);
    },
    readDirectory: async (path) => {
      const prefix = `${path}/`;
      return [...files.keys()]
        .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
        .map((name) => name.slice(prefix.length))
        .sort();
    },
  };
  return { fs, files, directories };
}

function routingEvent(input: Partial<SmartRoutingDecisionEvent> = {}): SmartRoutingDecisionEvent {
  return {
    schemaVersion: 1,
    eventId: '1727000000000-test1',
    timestamp: '2026-09-23T12:00:00.000Z',
    source: 'ccr',
    harnessId: 'claude',
    mode: 'shadow',
    classifierVersion: 'heuristic-v1',
    tier: 'simple',
    score: -3.5,
    confidence: 'high',
    reasonCodes: ['short-prompt', 'simple-language-indicator'],
    requestModel: 'Provider/main',
    candidateModel: 'Provider/fast',
    routeMutationRequested: false,
    routeSkipReason: 'shadow-mode',
    promptChars: 14,
    requestInputTokenEstimate: 8,
    toolCount: 0,
    hasImage: false,
    decisionLatencyMs: 1,
    measurement: {
      status: 'not-measured',
      resolvedModel: null,
      providerInputTokens: null,
      providerOutputTokens: null,
      qualityGate: 'unknown',
    },
    ...input,
  };
}

function context(overrides: Partial<CommandContext> = {}, initial: Record<string, unknown> = {}) {
  const memory = memoryFileSystem(initial);
  const result = {
    fs: memory.fs,
    runner: {},
    facts: { os: 'linux' },
    paths: { state: '/state' },
    projectRoot: '/project',
    localDatabase: null,
    projectIdFor: () => 'project-hash',
  };
  const commandContext = {
    adapters: result,
    platform: { os: 'linux', nodeVersion: '22.13.0' },
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: '/state',
    harness: null,
    provider: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-24T12:00:00.000Z',
    ...overrides,
  } as unknown as CommandContext;
  return { commandContext, ...memory };
}

describe('Smart Model Routing CLI', () => {
  it('exports a shadow CCR script for Claude and Codex without editing CCR configuration', async () => {
    const { commandContext, directories } = context({
      routingScript: true,
      harness: 'claude' as never,
    });
    const result = await runSmartRouting(commandContext);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.kind, 'ccr-script');
    if (result.data?.kind !== 'ccr-script') return;
    assert.equal(result.data.harnessId, 'claude');
    assert.equal(result.data.mode, 'shadow');
    assert.match(result.data.script, /return null;/);
    assert.ok(directories.has('/state/smart-routing'));
  });

  it('reports decision counts separately and never turns routing into a savings total', async () => {
    const timestamp = Date.parse('2026-09-23T12:00:00.000Z');
    const event = routingEvent();
    const path = `/state/smart-routing/smart-routing-${String(timestamp).padStart(13, '0')}-test1.json`;
    const { commandContext } = context({ routingMetrics: true }, { [path]: event });
    const result = await runSmartRouting(commandContext);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.kind, 'metrics');
    if (result.data?.kind !== 'metrics') return;
    assert.equal(result.data.metrics.retainedDecisionCount, 1);
    assert.equal(result.data.metrics.byHarness.claude, 1);
    assert.equal(result.data.metrics.savingsStatus, 'not-measured');
    assert.equal(result.data.metrics.savingsMeasurementCount, 0);
  });

  it('previews, applies, verifies, and surgically rolls back a CCR rule', async () => {
    let savedConfig: Record<string, unknown> = {
      APIKEY: 'private-ccr-key',
      Router: {
        builtInRules: { codex: { enabled: true } },
        rules: [{ id: 'user-rule', enabled: true }],
      },
    };
    const calls: string[] = [];
    const ccrFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; args?: unknown[] };
      calls.push(body.method);
      let value: unknown;
      if (body.method === 'getAppInfo') value = { version: '3.1.1', configDir: '/private/ccr' };
      else if (body.method === 'getConfig') value = savedConfig;
      else if (body.method === 'getGatewayStatus') value = { state: 'running' };
      else if (body.method === 'validateRouteScript') value = { ok: true, diagnostics: [] };
      else if (body.method === 'saveConfig') {
        savedConfig = body.args?.[0] as Record<string, unknown>;
        value = { ok: true };
      } else value = null;
      return new Response(JSON.stringify({ ok: true, value }), { status: 200 });
    };
    const { commandContext, files } = context({
      routingCcrConfigure: true,
      harness: 'claude' as never,
      env: { CCR_WEB_AUTH_TOKEN: 'private-ccr-token' },
      ccrFetch,
    });

    const preview = await runSmartRouting(commandContext);
    assert.equal(preview.data?.kind, 'ccr-configuration');
    if (preview.data?.kind !== 'ccr-configuration') return;
    assert.equal(preview.data.state, 'preview');
    assert.deepEqual((savedConfig['Router'] as { rules: unknown[] }).rules, [
      { id: 'user-rule', enabled: true },
    ]);
    assert.equal(JSON.stringify(preview.data).includes('private-ccr-key'), false);
    assert.equal(JSON.stringify(preview.data).includes('private-ccr-token'), false);

    const applied = await runSmartRouting({ ...commandContext, confirmed: true });
    assert.equal(applied.data?.kind, 'ccr-configuration');
    if (applied.data?.kind !== 'ccr-configuration') return;
    assert.equal(applied.data.state, 'configured');
    const appliedRules = (savedConfig['Router'] as { rules: Array<{ id: string }> }).rules;
    assert.equal(appliedRules[0]?.id, 'token-harness-smart-routing-claude-v1');
    assert.equal(appliedRules[1]?.id, 'user-rule');
    assert.equal(savedConfig['APIKEY'], 'private-ccr-key');
    assert.ok([...files.keys()].some((name) => name.endsWith('smart-routing-claude.js')));
    assert.ok(calls.includes('validateRouteScript'));
    assert.ok(calls.includes('saveConfig'));

    const modeChange = await runSmartRouting({
      ...commandContext,
      routingMode: 'conservative',
      confirmed: true,
    });
    assert.equal(modeChange.diagnostics[0]?.code, 'ccr-route-mode-requires-rollback');
    assert.equal(
      (savedConfig['Router'] as { rules: Array<{ id: string }> }).rules[0]?.id,
      'token-harness-smart-routing-claude-v1',
    );

    const rollbackPreview = await runSmartRouting({
      ...commandContext,
      routingCcrConfigure: false,
      routingCcrRollback: true,
      confirmed: false,
    });
    assert.equal(rollbackPreview.data?.kind, 'ccr-configuration');
    if (rollbackPreview.data?.kind !== 'ccr-configuration') return;
    assert.equal(rollbackPreview.data.state, 'preview');

    const rolledBack = await runSmartRouting({
      ...commandContext,
      routingCcrConfigure: false,
      routingCcrRollback: true,
      confirmed: true,
    });
    assert.equal(rolledBack.data?.kind, 'ccr-configuration');
    if (rolledBack.data?.kind !== 'ccr-configuration') return;
    assert.equal(rolledBack.data.state, 'rolled-back');
    assert.deepEqual((savedConfig['Router'] as { rules: unknown[] }).rules, [
      { id: 'user-rule', enabled: true },
    ]);
    assert.equal(
      [...files.keys()].some((name) => name.endsWith('smart-routing-claude.js')),
      false,
    );
    assert.equal(JSON.stringify(rolledBack.data).includes('private-ccr-token'), false);
  });

  it('fails closed when CCR configuration changes after the setup preview', async () => {
    const original: Record<string, unknown> = {
      Router: { rules: [{ id: 'user-rule', enabled: true }] },
    };
    let configReads = 0;
    let saveCalled = false;
    const ccrFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      let value: unknown;
      if (body.method === 'getAppInfo') value = { version: '3.1.1' };
      else if (body.method === 'getConfig') {
        configReads += 1;
        value = configReads === 1 ? original : { ...original, externalEdit: true };
      } else if (body.method === 'getGatewayStatus') value = { state: 'running' };
      else if (body.method === 'validateRouteScript') value = { ok: true };
      else if (body.method === 'saveConfig') {
        saveCalled = true;
        value = { ok: true };
      } else value = null;
      return new Response(JSON.stringify({ ok: true, value }), { status: 200 });
    };
    const { commandContext, files } = context({
      routingCcrConfigure: true,
      harness: 'codex' as never,
      confirmed: true,
      env: { CCR_WEB_AUTH_TOKEN: 'private-token' },
      ccrFetch,
    });

    const result = await runSmartRouting(commandContext);

    assert.equal(result.diagnostics[0]?.code, 'ccr-config-changed-during-operation');
    assert.equal(saveCalled, false);
    assert.equal(
      [...files.keys()].some((path) => path.includes('ccr-ownership-codex.json')),
      false,
    );
    assert.equal(
      [...files.keys()].some((path) => path.endsWith('smart-routing-codex.js')),
      false,
    );
  });

  it('reports metadata-only CCR request usage without claiming savings', async () => {
    const timestamp = Date.parse('2026-09-23T12:00:00.000Z');
    const event = routingEvent({ schemaVersion: 2, sessionId: 'session-usage' });
    const path = `/state/smart-routing/smart-routing-${String(timestamp).padStart(13, '0')}-test1.json`;
    const ccrFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getAppInfo') {
        return new Response(JSON.stringify({ ok: true, value: { version: '3.1.1' } }), {
          status: 200,
        });
      }
      assert.equal(body.method, 'getAgentAnalysis');
      const value = {
        selectedSession: {
          session: { agent: 'claude-code', id: 'claude-code:session-usage' },
          conversation: [{ user: { content: 'private prompt' } }],
          requests: [
            {
              sessionId: 'session-usage',
              createdAt: '2026-09-23T12:00:01.000Z',
              model: 'Provider/fast',
              inputTokens: 30,
              outputTokens: 12,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 42,
              costUsd: 0.002,
            },
          ],
        },
      };
      return new Response(JSON.stringify({ ok: true, value }), { status: 200 });
    };
    const { commandContext } = context(
      {
        routingMetrics: true,
        routingCcrUsage: true,
        env: { CCR_WEB_AUTH_TOKEN: 'private-ccr-token' },
        ccrFetch,
      },
      { [path]: event },
    );
    const result = await runSmartRouting(commandContext);

    assert.equal(result.data?.kind, 'metrics');
    if (result.data?.kind !== 'metrics') return;
    assert.equal(result.data.ccrUsage?.status, 'observed');
    assert.equal(result.data.ccrUsage?.requestCount, 1);
    assert.equal(result.data.ccrUsage?.totalTokens, 42);
    assert.equal(result.data.metrics.savingsStatus, 'not-measured');
    assert.equal(JSON.stringify(result.data).includes('private prompt'), false);
    assert.equal(JSON.stringify(result.data).includes('private-ccr-token'), false);
  });

  it('prunes only routing records when explicitly requested', async () => {
    const initial: Record<string, unknown> = {};
    for (let index = 0; index < 201; index += 1) {
      const timestamp = Date.parse('2026-09-23T00:00:00.000Z') + index * 1000;
      const id = `${String(timestamp).padStart(13, '0')}-r${String(index).padStart(3, '0')}`;
      initial[`/state/smart-routing/smart-routing-${id}.json`] = routingEvent({
        eventId: id,
        timestamp: new Date(timestamp).toISOString(),
      });
    }
    initial['/state/smart-routing/smart-routing-not-event.json'] = { userOwned: true };
    const { commandContext, files } = context(
      { routingMetrics: true, routingPrune: true },
      initial,
    );
    const result = await runSmartRouting(commandContext);

    assert.equal(result.data?.kind, 'metrics');
    if (result.data?.kind !== 'metrics') return;
    assert.equal(result.data.metrics.prunedRecordCount, 1);
    assert.equal(result.data.metrics.retainedDecisionCount, 200);
    assert.equal(files.size, 201);
  });

  it('requires exactly one routing action', async () => {
    const { commandContext } = context();
    const result = await runSmartRouting(commandContext);
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'routing-action-required');
  });
});

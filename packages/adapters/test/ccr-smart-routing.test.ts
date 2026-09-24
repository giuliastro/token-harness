import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import test from 'node:test';

import { createCcrSmartRoutingScript } from '../src/routing/ccr-smart-routing.js';

type CcrInput = {
  model?: string;
  tokenCount?: number;
  sessionId?: string;
  headers?: Record<string, string | string[]>;
  summary?: { lastUserText?: string; toolNames?: string[]; hasImage?: boolean } | null;
};

type CcrApi = {
  env(name: string): string | undefined;
  fs: { writeJson(path: string, event: Record<string, unknown>): Promise<void> };
};

function executeCcrScript(
  source: string,
  input: CcrInput,
  environment: Record<string, string> = {},
) {
  const writes: Array<{ path: string; event: Record<string, unknown> }> = [];
  const api: CcrApi = {
    env(name: string) {
      return environment[name];
    },
    fs: {
      async writeJson(path: string, event: Record<string, unknown>) {
        writes.push({ path, event });
      },
    },
  };
  const rule = new Script(`(async function(input, api) { ${source}\n})`).runInNewContext() as (
    input: CcrInput,
    api: CcrApi,
  ) => Promise<unknown>;
  return { result: rule(input, api), writes };
}

test('generated CCR shadow rule classifies without changing the request or persisting its prompt', async () => {
  const prompt = 'What is 2 + 2? keep-this-private';
  const source = createCcrSmartRoutingScript({
    harnessId: 'claude',
    telemetryDirectory: '/private/token-harness/smart-routing',
    pathSeparator: '/',
  });
  const { result, writes } = executeCcrScript(
    source,
    {
      model: 'Provider/main',
      tokenCount: 12,
      sessionId: 'session-abc',
      headers: { 'user-agent': 'claude-code/2.1.0' },
      summary: { lastUserText: prompt, toolNames: [], hasImage: false },
    },
    { TOKEN_HARNESS_ROUTING_SIMPLE_MODEL: 'Provider/fast' },
  );

  assert.equal(await result, null);
  assert.equal(writes.length, 1);
  assert.match(
    writes[0]?.path ?? '',
    /^\/private\/token-harness\/smart-routing\/smart-routing-\d{13}-[a-z0-9]+\.json$/,
  );
  assert.equal(writes[0]?.event['harnessId'], 'claude');
  assert.equal(writes[0]?.event['mode'], 'shadow');
  assert.equal(writes[0]?.event['candidateModel'], 'Provider/fast');
  assert.equal(writes[0]?.event['routeMutationRequested'], false);
  assert.equal(writes[0]?.event['sessionId'], 'session-abc');
  assert.equal(JSON.stringify(writes[0]?.event).includes(prompt), false);
  assert.equal(source.includes('api.fetch'), false);
});

test('conservative mode returns a configured simple model only for a high-confidence safe request', async () => {
  const source = createCcrSmartRoutingScript({
    harnessId: 'codex',
    mode: 'conservative',
    telemetryDirectory: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness\\smart-routing',
    pathSeparator: '\\',
  });
  const { result, writes } = executeCcrScript(
    source,
    {
      model: 'Provider/main',
      tokenCount: 12,
      sessionId: 'codex-session',
      headers: { 'user-agent': 'openai-codex/0.1.0' },
      summary: { lastUserText: 'What is 2 + 2?', toolNames: [], hasImage: false },
    },
    { TOKEN_HARNESS_ROUTING_SIMPLE_MODEL: 'Provider/fast' },
  );

  assert.equal(((await result) as { model?: string } | null)?.model, 'Provider/fast');
  assert.equal(writes[0]?.event['harnessId'], 'codex');
  assert.equal(writes[0]?.event['routeMutationRequested'], true);
  assert.equal(writes[0]?.event['sessionId'], 'codex-session');
});

test('keeps CCR model aliases with spaces in provider display names', async () => {
  const source = createCcrSmartRoutingScript({
    harnessId: 'claude',
    mode: 'conservative',
    telemetryDirectory: '/state/smart-routing',
    pathSeparator: '/',
    simpleModel: 'Claude Code API/claude-haiku-4-5',
  });
  const { result, writes } = executeCcrScript(source, {
    model: 'Claude Code API/claude-sonnet-4-5',
    headers: { 'user-agent': 'claude-code/2.1.0' },
    summary: { lastUserText: 'What is 2 + 2?', toolNames: [], hasImage: false },
  });

  assert.equal(
    ((await result) as { model?: string } | null)?.model,
    'Claude Code API/claude-haiku-4-5',
  );
  assert.equal(writes[0]?.event['requestModel'], 'Claude Code API/claude-sonnet-4-5');
  assert.equal(writes[0]?.event['candidateModel'], 'Claude Code API/claude-haiku-4-5');
});

test('conservative mode preserves requests with unconfirmed tool compatibility', async () => {
  const source = createCcrSmartRoutingScript({
    harnessId: 'codex',
    mode: 'conservative',
    telemetryDirectory: '/state/smart-routing',
    pathSeparator: '/',
  });
  const input = {
    model: 'Provider/main',
    tokenCount: 12,
    headers: { 'user-agent': 'openai-codex/0.1.0' },
    summary: { lastUserText: 'What is 2 + 2?', toolNames: ['read_file'], hasImage: false },
  };
  const defaultTools = executeCcrScript(source, input, {
    TOKEN_HARNESS_ROUTING_SIMPLE_MODEL: 'Provider/fast',
  });
  const explicitlyCompatible = executeCcrScript(source, input, {
    TOKEN_HARNESS_ROUTING_SIMPLE_MODEL: 'Provider/fast',
    TOKEN_HARNESS_ROUTING_ALLOW_TOOLS: 'true',
  });

  assert.equal(await defaultTools.result, null);
  assert.equal(defaultTools.writes[0]?.event['routeSkipReason'], 'tool-compatibility-unconfirmed');
  assert.equal(
    ((await explicitlyCompatible.result) as { model?: string } | null)?.model,
    'Provider/fast',
  );
});

test('generated rule fails open without a trusted harness identity signal', async () => {
  const source = createCcrSmartRoutingScript({
    harnessId: 'claude',
    mode: 'conservative',
    telemetryDirectory: '/state/smart-routing',
    pathSeparator: '/',
  });
  const { result, writes } = executeCcrScript(
    source,
    {
      model: 'Provider/main',
      summary: { lastUserText: 'What is 2 + 2?', toolNames: [], hasImage: false },
    },
    { TOKEN_HARNESS_ROUTING_SIMPLE_MODEL: 'Provider/fast' },
  );
  assert.equal(await result, null);
  assert.equal(writes.length, 0);
});

test('conservative mode preserves the current route when the request model is unavailable', async () => {
  const source = createCcrSmartRoutingScript({
    harnessId: 'codex',
    mode: 'conservative',
    telemetryDirectory: '/state/smart-routing',
    pathSeparator: '/',
  });
  const { result, writes } = executeCcrScript(
    source,
    {
      headers: { 'user-agent': 'openai-codex/0.1.0' },
      summary: { lastUserText: 'What is 2 + 2?', toolNames: [], hasImage: false },
    },
    { TOKEN_HARNESS_ROUTING_SIMPLE_MODEL: 'Provider/fast' },
  );

  assert.equal(await result, null);
  assert.equal(writes[0]?.event['routeSkipReason'], 'request-model-unavailable');
});

test('CCR telemetry write failures fail open without blocking or changing shadow behavior', async () => {
  const source = createCcrSmartRoutingScript({
    harnessId: 'claude',
    telemetryDirectory: '/state/smart-routing',
    pathSeparator: '/',
  });
  const rule = new Script(`(async function(input, api) { ${source}\n})`).runInNewContext() as (
    input: CcrInput,
    api: {
      env(name: string): string | undefined;
      fs: { writeJson(path: string, event: unknown): Promise<void> };
    },
  ) => Promise<unknown>;

  await assert.doesNotReject(() =>
    rule(
      {
        model: 'Provider/main',
        tokenCount: 10,
        summary: { lastUserText: 'What is 2 + 2?', toolNames: [], hasImage: false },
      },
      {
        env: () => undefined,
        fs: {
          writeJson: async () => {
            throw new Error('read-only directory');
          },
        },
      },
    ),
  );
  assert.equal(
    await rule(
      {
        model: 'Provider/main',
        tokenCount: 10,
        summary: { lastUserText: 'What is 2 + 2?', toolNames: [], hasImage: false },
      },
      {
        env: () => undefined,
        fs: {
          writeJson: async () => {
            throw new Error('read-only directory');
          },
        },
      },
    ),
    null,
  );
});

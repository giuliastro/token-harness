import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileStat, PlatformFacts, ProcessOutcome, ProcessRequest } from '@token-harness/core';

import type { CommandContext } from '../src/commands/context.js';
import { readMcptoonManifestFootprint } from '../src/commands/mcptoon-manifest-footprint.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function contextWithCache(rawCache: string | null, version = '0.7.10'): CommandContext {
  const cachePath = '/home/dev/.cache/mcptoon/schema_cache.json';
  const encoded = new TextEncoder();
  return {
    platform: PLATFORM,
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: '/state',
    harness: null,
    provider: null,
    baselineReceipt: null,
    optimizedReceipt: null,
    benchmarkId: null,
    benchmarkVariant: null,
    benchmarkQuality: null,
    benchmarkAttempts: null,
    benchmarkFailedAttempts: null,
    optimizationCandidate: null,
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    nativePolicy: false,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-13T10:10:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat: async (path): Promise<FileStat | null> => {
          if (path !== cachePath || rawCache === null) return null;
          return { kind: 'file', byteLength: encoded.encode(rawCache).byteLength, mode: null };
        },
        readFile: async (path) => {
          if (path !== cachePath || rawCache === null) throw new Error('missing');
          return encoded.encode(rawCache);
        },
        writeFile: async () => undefined,
        appendFile: async () => undefined,
        createDirectory: async () => undefined,
        remove: async () => undefined,
        readDirectory: async () => [],
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => ({
          displayCommand: request.executable,
          interpreter: 'direct',
          executablePath: '/usr/bin/mcptoon',
          exitCode: 0,
          signal: null,
          stdout: `mcptoon ${version}\n`,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        }),
      },
      paths: {
        home: '/home/dev',
        config: '/home/dev/.config/token-harness',
        data: '/home/dev/.local/share/token-harness',
        state: '/state',
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
  };
}

function reviewedCache(): string {
  return JSON.stringify({
    'private-server-b': {
      ts: Date.parse('2026-09-13T10:05:00.000Z') / 1000,
      fp: 'private-fingerprint',
      tools: [
        {
          name: 'secret_tool_two',
          description: 'private description',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'private query' } },
            required: ['query'],
          },
        },
      ],
    },
    'private-server-a': {
      ts: Date.parse('2026-09-13T10:00:00.000Z') / 1000,
      fp: 'another-private-fingerprint',
      tools: [
        {
          name: 'secret_tool_one',
          description: 'another private description',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    },
  });
}

describe('mcptoon manifest footprint witness', () => {
  it('derives aggregate JSON-to-compact bytes without retaining private schema identities', async () => {
    const result = await readMcptoonManifestFootprint(contextWithCache(reviewedCache()));

    assert.equal(result.state, 'observed');
    assert.equal(result.version, '0.7.10');
    assert.equal(result.serverCount, 2);
    assert.equal(result.toolCount, 2);
    assert.ok((result.jsonBytes ?? 0) > (result.compactBytes ?? 0));
    assert.equal(result.reductionBytes, (result.jsonBytes ?? 0) - (result.compactBytes ?? 0));
    assert.ok((result.reductionPercent ?? 0) > 0);
    assert.equal(result.oldestCacheEntryAt, '2026-09-13T10:00:00.000Z');
    assert.equal(result.newestCacheEntryAt, '2026-09-13T10:05:00.000Z');

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /private-server|secret_tool|private description|private query|private-fingerprint/,
    );
  });

  it('does not contact configured MCP servers while measuring the local cache', async () => {
    const commands: string[] = [];
    const base = contextWithCache(reviewedCache());
    const context: CommandContext = {
      ...base,
      adapters:
        base.adapters === null
          ? null
          : {
              ...base.adapters,
              runner: {
                run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
                  commands.push(`${request.executable} ${request.args.join(' ')}`);
                  return {
                    displayCommand: request.executable,
                    interpreter: 'direct',
                    executablePath: '/usr/bin/mcptoon',
                    exitCode: 0,
                    signal: null,
                    stdout: 'mcptoon 0.7.10\n',
                    stderr: '',
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    durationMs: 1,
                    timedOut: false,
                    failure: null,
                  };
                },
              },
            },
    };

    const result = await readMcptoonManifestFootprint(context);
    assert.equal(result.state, 'observed');
    assert.deepEqual(commands, ['mcptoon --version']);
  });

  it('fails closed on an unreviewed mcptoon version', async () => {
    const result = await readMcptoonManifestFootprint(contextWithCache(reviewedCache(), '0.8.0'));
    assert.equal(result.state, 'unsupported-version');
    assert.equal(result.version, '0.8.0');
    assert.equal(result.jsonBytes, null);
    assert.equal(result.compactBytes, null);
  });

  it('keeps an absent cache unavailable instead of fabricating zero-byte savings', async () => {
    const result = await readMcptoonManifestFootprint(contextWithCache(null));
    assert.equal(result.state, 'unavailable');
    assert.equal(result.jsonBytes, null);
    assert.equal(result.compactBytes, null);
    assert.equal(result.reductionPercent, null);
  });

  it('rejects malformed cache entries instead of partially counting them', async () => {
    const raw = JSON.stringify({ server: { ts: 1, tools: [{ description: 'missing name' }] } });
    const result = await readMcptoonManifestFootprint(contextWithCache(raw));
    assert.equal(result.state, 'invalid');
    assert.equal(result.toolCount, null);
  });
});

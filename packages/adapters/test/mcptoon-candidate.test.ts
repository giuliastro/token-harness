import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  FileSystemPort,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import {
  MCPTOON_MINIMUM_BENCHMARK_VERSION,
  mcptoonVersionAtLeast,
  observeMcptoonCandidate,
  parseMcptoonManifestCapabilities,
  parseMcptoonVersion,
  type ProviderContext,
} from '../src/providers/index.js';

const FACTS: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const NO_FILESYSTEM: FileSystemPort = {
  join: (...segments) => segments.join('/'),
  dirname: (path) => path,
  basename: (path) => path,
  isInside: () => false,
  stat: () => Promise.reject(new Error('observer must not read files')),
  readFile: () => Promise.reject(new Error('observer must not read files')),
  writeFile: () => Promise.reject(new Error('observer must not write files')),
  appendFile: () => Promise.reject(new Error('observer must not write files')),
  createDirectory: () => Promise.reject(new Error('observer must not write files')),
  remove: () => Promise.reject(new Error('observer must not write files')),
  readDirectory: () => Promise.resolve([]),
};

interface RunnerOptions {
  version?: string | null;
  manifestHelp?: string | null;
}

function fakeOutcome(request: ProcessRequest, payload: string | null): ProcessOutcome {
  const missing = payload === null;
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: missing ? null : '/usr/local/bin/mcptoon',
    exitCode: missing ? null : 0,
    signal: null,
    stdout: payload ?? '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: missing
      ? {
          reason: 'executable-not-found',
          message: 'mcptoon missing',
        }
      : null,
  };
}

function runner(options: RunnerOptions): ProcessRunner {
  return {
    run: (request: ProcessRequest): Promise<ProcessOutcome> => {
      let payload: string | null = null;
      if (request.args[0] === '--version') {
        payload = options.version ?? null;
      } else if (request.args[0] === 'manifest' && request.args[1] === '--help') {
        payload = options.manifestHelp ?? null;
      }
      return Promise.resolve(fakeOutcome(request, payload));
    },
  };
}

function context(options: RunnerOptions): ProviderContext {
  return {
    fs: NO_FILESYSTEM,
    runner: runner(options),
    facts: FACTS,
    paths: {
      home: '/home/dev',
      config: '/home/dev/.config/token-harness',
      data: '/home/dev/.local/share/token-harness',
      state: '/home/dev/.local/state/token-harness',
      cache: '/home/dev/.cache/token-harness',
    },
    projectRoot: '/work/demo',
    harnessConfigs: [],
    now: () => '2026-09-09T14:00:00.000Z',
    localDatabase: null,
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

test('parses mcptoon semantic versions and benchmark floor', () => {
  assert.equal(parseMcptoonVersion('mcptoon 0.7.8'), '0.7.8');
  assert.equal(parseMcptoonVersion('mcptoon version unknown'), null);
  assert.equal(MCPTOON_MINIMUM_BENCHMARK_VERSION, '0.7.8');
  assert.equal(mcptoonVersionAtLeast('0.7.8', '0.7.8'), true);
  assert.equal(mcptoonVersionAtLeast('0.8.0', '0.7.8'), true);
  assert.equal(mcptoonVersionAtLeast('0.7.7', '0.7.8'), false);
  assert.equal(mcptoonVersionAtLeast('0.7.8-beta.1', '0.7.8'), false);
});

test('recognizes explicit compact and JSON manifest surfaces', () => {
  assert.deepEqual(parseMcptoonManifestCapabilities('Options: --compact --json --full'), {
    compact: true,
    json: true,
  });
  assert.deepEqual(parseMcptoonManifestCapabilities('Options: --compact --full'), {
    compact: true,
    json: false,
  });
});

test('reports mcptoon absent without reading files', async () => {
  const observation = await observeMcptoonCandidate(context({ version: null }));
  assert.equal(observation.state, 'absent');
  assert.equal(observation.version, null);
  assert.equal(observation.executable, null);
});

test('rejects an older benchmark candidate', async () => {
  const observation = await observeMcptoonCandidate(
    context({
      version: 'mcptoon 0.7.7',
      manifestHelp: 'Options: --compact --json',
    }),
  );
  assert.equal(observation.state, 'unsupported-version');
  assert.equal(observation.version, '0.7.7');
});

test('requires both benchmark manifest surfaces', async () => {
  const observation = await observeMcptoonCandidate(
    context({
      version: 'mcptoon 0.7.8',
      manifestHelp: 'Options: --compact --full',
    }),
  );
  assert.equal(observation.state, 'installed');
  assert.equal(observation.supportsCompactManifest, true);
  assert.equal(observation.supportsJsonManifest, false);
});

test('marks current mcptoon benchmark-ready without enabling it', async () => {
  const observation = await observeMcptoonCandidate(
    context({
      version: 'mcptoon 0.7.8',
      manifestHelp: 'Options: --compact --json --full',
    }),
  );
  assert.equal(observation.state, 'benchmark-ready');
  assert.equal(observation.version, '0.7.8');
  assert.equal(observation.executable, '/usr/local/bin/mcptoon');
  assert.match(observation.reasons[0] ?? '', /no sync or compression policy/);
});

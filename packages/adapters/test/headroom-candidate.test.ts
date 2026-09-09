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
  HEADROOM_MINIMUM_BENCHMARK_VERSION,
  headroomVersionAtLeast,
  observeHeadroomCandidate,
  parseHeadroomVersion,
  parseHeadroomWrapTargets,
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
  stat: () => Promise.reject(new Error('Headroom candidate observation must not read files')),
  readFile: () => Promise.reject(new Error('Headroom candidate observation must not read files')),
  writeFile: () => Promise.reject(new Error('Headroom candidate observation must not write files')),
  appendFile: () => Promise.reject(new Error('Headroom candidate observation must not write files')),
  createDirectory: () => Promise.reject(new Error('Headroom candidate observation must not write files')),
  remove: () => Promise.reject(new Error('Headroom candidate observation must not write files')),
  readDirectory: () => Promise.resolve([]),
};

interface RunnerOptions {
  version?: string | null;
  wrapHelp?: string | null;
}

function fakeOutcome(request: ProcessRequest, payload: string | null): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: payload === null ? null : '/usr/local/bin/headroom',
    exitCode: payload === null ? null : 0,
    signal: null,
    stdout: payload ?? '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure:
      payload === null
        ? { reason: 'executable-not-found', message: 'headroom is not installed' }
        : null,
  };
}

function runner(options: RunnerOptions): ProcessRunner {
  return {
    run: (request: ProcessRequest): Promise<ProcessOutcome> => {
      const payload =
        request.args[0] === '--version'
          ? (options.version ?? null)
          : request.args[0] === 'wrap' && request.args[1] === '--help'
            ? (options.wrapHelp ?? null)
            : null;
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
    now: () => '2026-09-09T08:00:00.000Z',
    localDatabase: null,
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

test('parses Headroom semantic versions without trusting surrounding text', () => {
  assert.equal(parseHeadroomVersion('headroom 0.36.0'), '0.36.0');
  assert.equal(parseHeadroomVersion('headroom version unknown'), null);
});

test('requires the current benchmark floor', () => {
  assert.equal(HEADROOM_MINIMUM_BENCHMARK_VERSION, '0.36.0');
  assert.equal(headroomVersionAtLeast('0.36.0', '0.36.0'), true);
  assert.equal(headroomVersionAtLeast('0.37.1', '0.36.0'), true);
  assert.equal(headroomVersionAtLeast('0.35.9', '0.36.0'), false);
});

test('recognizes Claude and Codex only when wrap help advertises them', () => {
  assert.deepEqual(parseHeadroomWrapTargets('Supported commands: claude codex aider'), {
    claude: true,
    codex: true,
  });
  assert.deepEqual(parseHeadroomWrapTargets('Supported commands: claude aider'), {
    claude: true,
    codex: false,
  });
});

test('reports Headroom absent without attempting to treat it as configured', async () => {
  const observation = await observeHeadroomCandidate(context({ version: null }));
  assert.equal(observation.state, 'absent');
  assert.equal(observation.version, null);
  assert.equal(observation.executable, null);
  assert.equal(observation.supportsClaudeWrap, false);
  assert.equal(observation.supportsCodexWrap, false);
});

test('keeps an older Headroom build out of paired benchmark admission', async () => {
  const observation = await observeHeadroomCandidate(
    context({
      version: 'headroom 0.35.9',
      wrapHelp: 'Commands: claude codex aider',
    }),
  );
  assert.equal(observation.state, 'unsupported-version');
  assert.equal(observation.version, '0.35.9');
  assert.equal(observation.supportsClaudeWrap, true);
  assert.equal(observation.supportsCodexWrap, true);
});

test('requires both managed harness wrap targets before declaring benchmark readiness', async () => {
  const observation = await observeHeadroomCandidate(
    context({
      version: 'headroom 0.37.0',
      wrapHelp: 'Commands: claude aider',
    }),
  );
  assert.equal(observation.state, 'installed');
  assert.equal(observation.version, '0.37.0');
  assert.equal(observation.supportsClaudeWrap, true);
  assert.equal(observation.supportsCodexWrap, false);
});

test('marks the reviewed current Headroom line benchmark-ready without enabling it', async () => {
  const observation = await observeHeadroomCandidate(
    context({
      version: 'headroom 0.37.0',
      wrapHelp: 'Commands: claude codex aider',
    }),
  );
  assert.equal(observation.state, 'benchmark-ready');
  assert.equal(observation.version, '0.37.0');
  assert.equal(observation.executable, '/usr/local/bin/headroom');
  assert.deepEqual(observation.reasons, [
    'Headroom is eligible for paired experimental benchmarking; no integration has been enabled',
  ]);
});

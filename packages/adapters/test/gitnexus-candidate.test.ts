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
  observeGitNexusCandidate,
  parseGitNexusCliCapabilities,
  parseGitNexusVersion,
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
  readDirectory: () => Promise.reject(new Error('observer must not read files')),
};

interface RunnerOptions {
  version?: string | null;
  help?: string | null;
  statusHelp?: string | null;
}

function fakeOutcome(request: ProcessRequest, payload: string | null): ProcessOutcome {
  const missing = payload === null;
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: missing ? null : '/usr/local/bin/gitnexus',
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
          message: 'gitnexus missing',
        }
      : null,
  };
}

function runner(options: RunnerOptions, requests: ProcessRequest[]): ProcessRunner {
  return {
    run: (request: ProcessRequest): Promise<ProcessOutcome> => {
      requests.push(request);
      let payload: string | null = null;
      if (request.args[0] === '--version') {
        payload = options.version ?? null;
      } else if (request.args[0] === '--help') {
        payload = options.help ?? null;
      } else if (request.args[0] === 'status' && request.args[1] === '--help') {
        payload = options.statusHelp ?? null;
      }
      return Promise.resolve(fakeOutcome(request, payload));
    },
  };
}

function context(options: RunnerOptions, requests: ProcessRequest[] = []): ProviderContext {
  return {
    fs: NO_FILESYSTEM,
    runner: runner(options, requests),
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
    now: () => '2026-09-10T17:20:00.000Z',
    localDatabase: null,
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

const HELP = `Commands:\n  analyze [path]  Index a repository\n  status          Show index status\n  query [search]  Search the knowledge graph\n  context [name]  Show symbol context`;
const STATUS_HELP = `Usage: gitnexus status [options]\n\nOptions:\n  --json  Emit machine-readable status`;

test('parses GitNexus semantic versions', () => {
  assert.equal(parseGitNexusVersion('gitnexus 1.6.11'), '1.6.11');
  assert.equal(parseGitNexusVersion('1.7.0-rc.2'), '1.7.0-rc.2');
  assert.equal(parseGitNexusVersion('gitnexus dev'), null);
});

test('recognizes only the benchmark CLI surfaces', () => {
  assert.deepEqual(parseGitNexusCliCapabilities(HELP, STATUS_HELP), {
    query: true,
    context: true,
    statusJson: true,
  });
  assert.deepEqual(parseGitNexusCliCapabilities(HELP.replace('context [name]', 'inspect [name]'), ''), {
    query: true,
    context: false,
    statusJson: false,
  });
});

test('reports GitNexus absent without probing anything else', async () => {
  const requests: ProcessRequest[] = [];
  const observation = await observeGitNexusCandidate(context({ version: null }, requests));

  assert.equal(observation.state, 'absent');
  assert.equal(observation.version, null);
  assert.equal(observation.executable, null);
  assert.deepEqual(requests.map((request) => request.args), [['--version']]);
});

test('keeps an incomplete CLI installed but not benchmark-ready', async () => {
  const requests: ProcessRequest[] = [];
  const observation = await observeGitNexusCandidate(
    context(
      {
        version: 'gitnexus 1.6.11',
        help: HELP.replace('context [name]  Show symbol context\n', ''),
        statusHelp: STATUS_HELP,
      },
      requests,
    ),
  );

  assert.equal(observation.state, 'installed');
  assert.equal(observation.supportsQuery, true);
  assert.equal(observation.supportsContext, false);
  assert.equal(observation.supportsStatusJson, true);
  assert.match(observation.reasons[0] ?? '', /context/);
});

test('marks a capable local CLI benchmark-ready using only help/version probes', async () => {
  const requests: ProcessRequest[] = [];
  const observation = await observeGitNexusCandidate(
    context(
      {
        version: 'gitnexus 1.6.11',
        help: HELP,
        statusHelp: STATUS_HELP,
      },
      requests,
    ),
  );

  assert.equal(observation.state, 'benchmark-ready');
  assert.equal(observation.version, '1.6.11');
  assert.equal(observation.executable, '/usr/local/bin/gitnexus');
  assert.equal(observation.supportsQuery, true);
  assert.equal(observation.supportsContext, true);
  assert.equal(observation.supportsStatusJson, true);
  assert.deepEqual(
    requests.map((request) => request.args),
    [['--version'], ['--help'], ['status', '--help']],
  );
  for (const request of requests) {
    assert.equal(request.executable, 'gitnexus');
    assert.equal(request.cwd, '/work/demo');
  }
  assert.match(observation.reasons[0] ?? '', /no index, MCP, hooks, skills/);
});

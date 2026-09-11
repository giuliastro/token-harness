import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileStat, PlatformFacts } from '@token-harness/core';

import {
  parseCandidateBenchmarkAttribution,
  readCandidateBenchmarkAttribution,
  writeCandidateBenchmarkAttribution,
} from '../src/commands/candidate-benchmark-attribution.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function world() {
  const files = new Map<string, Uint8Array>();
  const stat = async (path: string): Promise<FileStat | null> => {
    const bytes = files.get(path);
    return bytes === undefined ? null : { kind: 'file', byteLength: bytes.byteLength, mode: null };
  };

  const context: CommandContext = {
    platform: PLATFORM,
    projectRoot: '/home/dev/project',
    home: '/home/dev',
    stateRoot: '/home/dev/.local/state/token-harness',
    harness: null,
    provider: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-11T12:00:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat,
        readFile: async (path) => {
          const bytes = files.get(path);
          if (bytes === undefined) throw new Error('missing');
          return bytes;
        },
        writeFile: async (path, bytes) => {
          files.set(path, new Uint8Array(bytes));
        },
        appendFile: async () => {
          throw new Error('not used');
        },
        createDirectory: async () => undefined,
        remove: async (path) => {
          files.delete(path);
        },
        readDirectory: async () => [],
      },
      runner: {
        run: async () => {
          throw new Error('not used');
        },
      },
      paths: {
        home: '/home/dev',
        config: '/home/dev/.config/token-harness',
        data: '/home/dev/.local/share/token-harness',
        state: '/home/dev/.local/state/token-harness',
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
  };

  return { context, files };
}

describe('candidate benchmark attribution sidecar', () => {
  it('parses only supported candidate identities', () => {
    assert.deepEqual(
      parseCandidateBenchmarkAttribution({
        schemaVersion: 1,
        benchmarkId: 'gitnexus-standard-1',
        candidateId: 'gitnexus',
        projectId: 'p_test',
      }),
      {
        schemaVersion: 1,
        benchmarkId: 'gitnexus-standard-1',
        candidateId: 'gitnexus',
        projectId: 'p_test',
      },
    );
    assert.equal(
      parseCandidateBenchmarkAttribution({
        schemaVersion: 1,
        benchmarkId: 'unknown-standard-1',
        candidateId: 'unknown',
        projectId: 'p_test',
      }),
      null,
    );
  });

  it('round-trips the experiment target without any activation state', async () => {
    const fixture = world();
    const written = await writeCandidateBenchmarkAttribution(fixture.context, {
      schemaVersion: 1,
      benchmarkId: 'headroom-standard-1',
      candidateId: 'headroom',
      projectId: 'p_test',
    });
    assert.equal(written, true);

    const read = await readCandidateBenchmarkAttribution(fixture.context, 'headroom-standard-1');
    if (typeof read === 'string') {
      assert.fail(`expected persisted candidate attribution, got ${read}`);
    }
    assert.equal('active' in read, false);
    assert.deepEqual(read, {
      schemaVersion: 1,
      benchmarkId: 'headroom-standard-1',
      candidateId: 'headroom',
      projectId: 'p_test',
    });
  });

  it('keeps malformed sidecars invalid instead of guessing attribution', async () => {
    const fixture = world();
    const path =
      '/home/dev/.local/state/token-harness/benchmarks/mcptoon-standard-1/candidate.json';
    fixture.files.set(path, new TextEncoder().encode('{"candidateId":"mcptoon"}\n'));

    assert.equal(
      await readCandidateBenchmarkAttribution(fixture.context, 'mcptoon-standard-1'),
      'invalid',
    );
  });
});

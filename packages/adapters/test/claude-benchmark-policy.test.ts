import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  digestBytes,
  type NativeEffortObservation,
  type FileSystemPort,
} from '@token-harness/core';
import type { HarnessContext } from '../src/index.js';
import { readClaudeBenchmarkPolicy } from '../src/harnesses/claude-benchmark-policy.js';

function fixture(settings: unknown = { model: 'claude-fixture-20260901', effortLevel: 'high' }) {
  const path = '/home/.claude/settings.json';
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  const files = new Map([[path, bytes]]);
  const fail = async (): Promise<never> => {
    throw new Error('no writes or process execution');
  };
  const fs: FileSystemPort = {
    join: (...parts) => parts.join('/'),
    dirname: () => '/',
    basename: () => 'settings.json',
    isInside: () => false,
    readDirectory: async () => [],
    stat: async (key) =>
      files.has(key) ? { kind: 'file', byteLength: files.get(key)!.length, mode: null } : null,
    readFile: async (key) => files.get(key)!,
    writeFile: fail,
    appendFile: fail,
    remove: fail,
    createDirectory: fail,
  };
  const context: HarnessContext = {
    fs,
    runner: { run: fail },
    projectRoot: '/project',
    facts: {
      os: 'linux',
      arch: 'x64',
      isWsl: false,
      osDisplayName: 'test',
      nodeVersion: '22.13.0',
    },
    paths: { home: '/home', config: '/config', state: '/state', data: '/data', cache: '/cache' },
  };
  const effort: NativeEffortObservation = {
    harnessVersion: '2.1.261',
    supported: ['low', 'medium', 'high', 'xhigh'],
    current: 'high',
    source: 'native-cli+filesystem',
    verification: 'config-only',
    writable: true,
    reason: '',
    path,
    files: [
      { path, digest: digestBytes(bytes) },
      { path: '/project/.claude/settings.json', digest: null },
    ],
    environment: {
      claudeConfigDirectory: null,
      codexConfigDirectory: null,
      claudeModelOverridden: false,
      claudeEffortOverridden: false,
      claudeBackendOverridden: false,
    },
  };
  return { context, effort, files, path };
}

describe('Claude controlled benchmark policy identity', () => {
  it('reads only the reviewed persisted tuple without claiming active-session control', async () => {
    const f = fixture();
    assert.deepEqual(await readClaudeBenchmarkPolicy(f.context, f.effort), {
      model: 'claude-fixture-20260901',
      reasoningEffort: 'high',
      verbosity: null,
      verification: 'config-only',
    });
  });
  for (const model of ['opus', 'sonnet', 'default', 'opusplan', '', 42, null]) {
    it('does not guess a full model from ' + String(model), async () => {
      const f = fixture({ model, effortLevel: 'high' });
      assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
    });
  }
  for (const key of [
    'modelOverrides',
    'availableModels',
    'fallbackModel',
    'modelFallbacks',
    'apiKeyHelper',
  ]) {
    it('does not learn around ' + key, async () => {
      const f = fixture({ model: 'claude-fixture', [key]: {} });
      assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
    });
  }
  it('refuses project model selection and unexpected settings created after observation', async () => {
    const f = fixture();
    const path = '/project/.claude/settings.json';
    f.files.set(path, new TextEncoder().encode('{"model":"claude-other"}'));
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
    f.effort.files[1]!.digest = digestBytes(f.files.get(path)!);
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
  });
  it('requires the reviewed environment, write compatibility and known effort', async () => {
    const f = fixture();
    assert.equal(await readClaudeBenchmarkPolicy(f.context, null), null);
    for (const patch of [{ writable: false }, { current: null }, { environment: null }])
      assert.equal(await readClaudeBenchmarkPolicy(f.context, { ...f.effort, ...patch }), null);
    for (const patch of [
      { claudeConfigDirectory: '/elsewhere' },
      { claudeEffortOverridden: true },
      { claudeModelOverridden: true },
      { claudeBackendOverridden: true },
    ])
      assert.equal(
        await readClaudeBenchmarkPolicy(f.context, {
          ...f.effort,
          environment: { ...f.effort.environment!, ...patch },
        }),
        null,
      );
  });
  it('refuses digest drift, disappearance and malformed settings', async () => {
    const f = fixture();
    f.files.set(f.path, new TextEncoder().encode('{"model":"claude-other"}'));
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
    f.files.delete(f.path);
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
    const malformed = new TextEncoder().encode('{');
    f.files.set(f.path, malformed);
    f.effort.files[0]!.digest = digestBytes(malformed);
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
  });
  it('bounds settings and fails closed on private IO errors', async () => {
    const f = fixture();
    f.context.fs.stat = async () => ({ kind: 'file', byteLength: 2_000_000, mode: null });
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
    f.context.fs.stat = async () => {
      throw new Error('private secret path');
    };
    assert.equal(await readClaudeBenchmarkPolicy(f.context, f.effort), null);
  });
});

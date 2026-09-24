import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileSystemPort, ProcessOutcome, ProcessRequest } from '@token-harness/core';

import { runSmartRouting } from '../src/commands/smart-routing.js';
import type { CommandContext } from '../src/commands/context.js';

function memoryFileSystem() {
  const files = new Map<string, Uint8Array>();
  const modes = new Map<string, string | null>();
  const directories = new Set<string>(['/state']);
  const fs: FileSystemPort = {
    join: (...segments) => segments.join('/').replace(/\/+/g, '/'),
    dirname: (path) => path.slice(0, path.lastIndexOf('/')) || '/',
    basename: (path) => path.slice(path.lastIndexOf('/') + 1),
    isInside: (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}/`),
    stat: async (path) =>
      files.has(path)
        ? { kind: 'file', byteLength: files.get(path)?.length ?? 0, mode: modes.get(path) ?? null }
        : null,
    canonicalPath: async (path) => path,
    readFile: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    writeFile: async (path, value, mode) => {
      files.set(path, value);
      modes.set(path, mode ?? null);
    },
    appendFile: async (path, value) => {
      files.set(path, new Uint8Array([...(files.get(path) ?? []), ...value]));
    },
    createDirectory: async (path) => {
      directories.add(path);
    },
    remove: async (path) => {
      files.delete(path);
      modes.delete(path);
    },
    readDirectory: async (path) =>
      [...files.keys()]
        .filter((name) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes('/'))
        .map((name) => name.slice(path.length + 1))
        .sort(),
  };
  return { fs, files, modes, directories };
}

function processOutcome(request: ProcessRequest, stdout = ''): ProcessOutcome {
  return {
    displayCommand: request.executable,
    interpreter: 'direct',
    executablePath: request.executable,
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: null,
  };
}

function testContext(overrides: Partial<CommandContext> = {}) {
  const memory = memoryFileSystem();
  const processRequests: ProcessRequest[] = [];
  const runner = {
    run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
      processRequests.push(request);
      if (request.executable === 'npm') {
        const prefix = request.args[2];
        assert.equal(typeof prefix, 'string');
        await memory.fs.writeFile(
          memory.fs.join(
            prefix!,
            'node_modules',
            '@musistudio',
            'claude-code-router',
            'package.json',
          ),
          new TextEncoder().encode(JSON.stringify({ version: '3.1.1' })),
        );
        return processOutcome(request);
      }
      return processOutcome(request, 'CCR Web Management http://127.0.0.1:3458');
    },
  };
  const ccrFetch: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('x-ccr-web-auth') === null)
      throw new Error('management service is not running yet');
    const body = JSON.parse(String(init?.body)) as { method: string };
    const value =
      body.method === 'getAppInfo'
        ? { version: '3.1.1' }
        : body.method === 'getGatewayStatus'
          ? { state: 'running' }
          : body.method === 'getConfig'
            ? { Providers: [], profile: { enabled: true, profiles: [] }, Router: { rules: [] } }
            : body.method === 'validateRouteScript' || body.method === 'saveConfig'
              ? { ok: true }
              : null;
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 });
  };
  const adapters = {
    fs: memory.fs,
    runner,
    paths: {},
    facts: { os: 'linux' },
    projectIdFor: () => 'project-test',
  };
  const commandContext = {
    adapters,
    platform: { os: 'linux', nodeVersion: '22.13.0', isWsl: false },
    projectRoot: '/project',
    home: '/home/test',
    stateRoot: '/state',
    harness: 'codex',
    provider: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-24T12:00:00.000Z',
    env: {},
    ccrFetch,
    routingCcrConfigure: true,
    ...overrides,
  } as unknown as CommandContext;
  return { commandContext, ...memory, processRequests };
}

describe('managed CCR CLI lifecycle', () => {
  it('previews a local npm install without installing or starting anything', async () => {
    const { commandContext, files, processRequests } = testContext();
    const result = await runSmartRouting(commandContext);

    assert.equal(result.data?.kind, 'ccr-lifecycle');
    if (result.data?.kind !== 'ccr-lifecycle') return;
    assert.equal(result.data.action, 'install');
    assert.equal(result.data.state, 'preview');
    assert.equal(files.size, 0);
    assert.equal(processRequests.length, 0);
  });

  it('does not overwrite an unrecognized runtime receipt', async () => {
    const { commandContext, fs, files, processRequests } = testContext({ confirmed: true });
    const path = '/state/smart-routing/ccr/runtime.json';
    const original = new TextEncoder().encode('{"userOwned":true}\n');
    await fs.writeFile(path, original, '0600');

    const result = await runSmartRouting(commandContext);

    assert.equal(result.diagnostics[0]?.code, 'ccr-runtime-receipt-unrecognized');
    assert.deepEqual(files.get(path), original);
    assert.equal(processRequests.length, 0);
  });

  it('does not replace a credential that has no valid ownership receipt', async () => {
    const { commandContext, fs, files, processRequests } = testContext({ confirmed: true });
    const path = '/state/smart-routing/ccr/web-auth-token';
    const original = new TextEncoder().encode('user-owned-token\n');
    await fs.writeFile(path, original, '0600');

    const result = await runSmartRouting(commandContext);

    assert.equal(result.diagnostics[0]?.code, 'ccr-runtime-token-unrecognized');
    assert.deepEqual(files.get(path), original);
    assert.equal(processRequests.length, 0);
  });

  it('installs only the exact managed package, stores a private token, and verifies the gateway', async () => {
    const { commandContext, files, modes, processRequests } = testContext({ confirmed: true });
    const result = await runSmartRouting(commandContext);

    assert.equal(result.data?.kind, 'ccr-lifecycle');
    if (result.data?.kind !== 'ccr-lifecycle') return;
    assert.equal(result.data.action, 'install');
    assert.equal(result.data.state, 'installed');
    const npm = processRequests.find((request) => request.executable === 'npm');
    assert.deepEqual(npm?.args.slice(0, 2), ['install', '--prefix']);
    assert.ok(npm?.args.includes('--package-lock=true'));
    assert.equal(npm?.args.at(-1), '@musistudio/claude-code-router@3.1.1');
    assert.ok(processRequests.some((request) => request.args.includes('--gateway')));
    assert.ok([...files.keys()].some((path) => path.endsWith('/runtime.json')));
    const tokenPath = [...files.keys()].find((path) => path.endsWith('/web-auth-token'));
    assert.ok(tokenPath);
    assert.equal(modes.get(tokenPath!), '0600');
    assert.equal(
      result.diagnostics.some((item) =>
        item.message.includes(new TextDecoder().decode(files.get(tokenPath!))),
      ),
      false,
    );
    assert.equal(
      JSON.stringify(result).includes(new TextDecoder().decode(files.get(tokenPath!)).trim()),
      false,
    );
  });

  it('previews and updates only its versioned managed package', async () => {
    const { commandContext, fs, files, processRequests } = testContext({
      routingCcrConfigure: false,
      routingCcrUpdate: true,
    });
    const oldPrefix = '/state/smart-routing/ccr/versions/3.0.0';
    const oldReceipt = {
      schemaVersion: 1,
      version: '3.0.0',
      installPrefix: oldPrefix,
      executablePath: `${oldPrefix}/node_modules/.bin/ccr`,
      managementEndpoint: 'http://127.0.0.1:3458',
      installedAt: '2026-09-01T12:00:00.000Z',
    };
    await fs.writeFile(
      '/state/smart-routing/ccr/runtime.json',
      new TextEncoder().encode(JSON.stringify(oldReceipt)),
      '0600',
    );
    await fs.writeFile(
      '/state/smart-routing/ccr/web-auth-token',
      new TextEncoder().encode('a'.repeat(43)),
      '0600',
    );

    const preview = await runSmartRouting(commandContext);
    assert.equal(preview.data?.kind, 'ccr-lifecycle');
    if (preview.data?.kind !== 'ccr-lifecycle') return;
    assert.equal(preview.data.action, 'update');
    assert.equal(preview.data.state, 'preview');
    assert.equal(processRequests.length, 0);

    const applied = await runSmartRouting({ ...commandContext, confirmed: true });
    assert.equal(applied.data?.kind, 'ccr-lifecycle');
    if (applied.data?.kind !== 'ccr-lifecycle') return;
    assert.equal(applied.data.action, 'update');
    assert.equal(applied.data.state, 'updated');
    assert.ok(
      processRequests.some(
        (request) => request.executable === oldReceipt.executablePath && request.args[0] === 'stop',
      ),
    );
    assert.ok(
      processRequests.some(
        (request) =>
          request.executable === 'npm' &&
          request.args.at(-1) === '@musistudio/claude-code-router@3.1.1',
      ),
    );
    assert.ok(processRequests.some((request) => request.args.includes('--gateway')));
    const runtimeReceipt = JSON.parse(
      new TextDecoder().decode(files.get('/state/smart-routing/ccr/runtime.json')!),
    ) as { version: string };
    assert.equal(runtimeReceipt.version, '3.1.1');
    assert.equal(JSON.stringify(applied).includes('a'.repeat(43)), false);
  });

  it('does not install beside an unauthenticated service already listening locally', async () => {
    const { commandContext, processRequests } = testContext({
      confirmed: true,
      ccrFetch: async () => new Response('not CCR', { status: 404 }),
    });
    const result = await runSmartRouting(commandContext);

    assert.equal(result.diagnostics[0]?.code, 'ccr-existing-service-auth-required');
    assert.equal(processRequests.length, 0);
  });
});

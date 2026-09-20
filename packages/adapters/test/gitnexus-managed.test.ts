import assert from 'node:assert/strict';
import test from 'node:test';

import {
  harnessId,
  jsonValueDigest,
  type FileStat,
  type FileSystemPort,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';

import {
  GITNEXUS_CLAUDE_MCP_POINTER,
  GITNEXUS_MCP_SERVER,
  GITNEXUS_REVIEWED_MCP_VERSION,
  gitnexusManagedProviderAdapter,
  planGitNexusManagedMcpActivation,
  planGitNexusManagedMcpRemoval,
  verifyGitNexusManagedMcpActivation,
  type ProviderContext,
} from '../src/providers/index.js';

const FACTS: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

class MemoryFs implements FileSystemPort {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>(['/', '/home', '/home/dev', '/work', '/work/demo']);

  join(...segments: string[]): string {
    return segments.join('/').replace(/\/+/g, '/');
  }
  dirname(path: string): string {
    return path.slice(0, Math.max(1, path.lastIndexOf('/')));
  }
  basename(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }
  isInside(candidate: string, parent: string): boolean {
    return candidate === parent || candidate.startsWith(`${parent}/`);
  }
  async stat(path: string): Promise<FileStat | null> {
    const file = this.files.get(path);
    if (file !== undefined) return { kind: 'file', byteLength: file.byteLength, mode: null };
    if (this.directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
    return null;
  }
  async readFile(path: string): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing fixture ${path}`);
    return value;
  }
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
  }
  async appendFile(path: string, content: Uint8Array): Promise<void> {
    const prior = this.files.get(path) ?? new Uint8Array();
    const merged = new Uint8Array(prior.byteLength + content.byteLength);
    merged.set(prior);
    merged.set(content, prior.byteLength);
    this.files.set(path, merged);
  }
  async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.directories.delete(path);
  }
  async readDirectory(_path: string): Promise<string[]> {
    return [];
  }
}

function processOutcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: '/usr/local/bin/gitnexus',
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

function runner(commands: string[] = [], version = GITNEXUS_REVIEWED_MCP_VERSION): ProcessRunner {
  return {
    run: (request) => {
      commands.push(`${request.executable} ${request.args.join(' ')}`);
      if (request.args[0] === '--version') {
        return Promise.resolve(processOutcome(request, `gitnexus ${version}`));
      }
      if (request.args[0] === '--help') {
        return Promise.resolve(
          processOutcome(
            request,
            'Commands:\n  status\n  query [search]\n  context [name]\n  mcp  Start the MCP server',
          ),
        );
      }
      if (request.args[0] === 'status' && request.args[1] === '--help') {
        return Promise.resolve(processOutcome(request, 'Options:\n  --json  machine readable'));
      }
      throw new Error(`unexpected command: ${request.executable} ${request.args.join(' ')}`);
    },
  };
}

function absentGitNexusRunner(commands: string[] = [], npmAvailable = true): ProcessRunner {
  return {
    run: (request) => {
      commands.push(`${request.executable} ${request.args.join(' ')}`);
      if (request.executable === 'npm' && request.args[0] === '--version' && npmAvailable) {
        return Promise.resolve(processOutcome(request, '11.6.0'));
      }
      return Promise.resolve({
        ...processOutcome(request, ''),
        executablePath: null,
        exitCode: null,
        failure: {
          reason: 'executable-not-found' as const,
          message: `${request.executable} missing`,
        },
      });
    },
  };
}

function context(fs: MemoryFs, commands: string[] = []): ProviderContext {
  return {
    fs,
    runner: runner(commands),
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
    now: () => '2026-09-13T12:00:00.000Z',
    localDatabase: null,
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

const ENCODER = new TextEncoder();

function setJson(fs: MemoryFs, value: unknown): void {
  fs.files.set('/home/dev/.claude.json', ENCODER.encode(`${JSON.stringify(value, null, 2)}\n`));
}

test('plans one owned Claude JSON entry and never invokes gitnexus setup or mcp', async () => {
  const fs = new MemoryFs();
  setJson(fs, { theme: 'dark', mcpServers: { existing: { command: 'other' } } });
  const commands: string[] = [];

  const plan = await planGitNexusManagedMcpActivation(context(fs, commands), harnessId('claude'));

  assert.equal(plan.target, '/home/dev/.claude.json');
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0];
  assert.ok(action?.kind === 'merge-json');
  assert.deepEqual(action.ownedPointers, [GITNEXUS_CLAUDE_MCP_POINTER]);
  assert.equal(action.operations.length, 1);
  assert.deepEqual(action.operations[0], {
    kind: 'set',
    pointer: GITNEXUS_CLAUDE_MCP_POINTER,
    value: GITNEXUS_MCP_SERVER,
    expectedValueDigest: null,
  });
  assert.equal(action.rollbackData, 'file-snapshot');
  assert.equal(action.requiresNetwork, false);
  assert.deepEqual(commands, ['gitnexus --version', 'gitnexus --help']);
});

test('Windows first-run can install reviewed GitNexus through npm and then register Claude MCP', async () => {
  const fs = new MemoryFs();
  setJson(fs, { theme: 'dark' });
  const commands: string[] = [];
  const base = context(fs, commands);
  const windows = {
    ...base,
    facts: { ...FACTS, os: 'windows' as const, osDisplayName: 'Windows 11' },
    runner: absentGitNexusRunner(commands),
  };

  const detection = await gitnexusManagedProviderAdapter.detect(windows);
  assert.equal(detection.state, 'absent');
  assert.deepEqual(detection.assignableHarnesses, [harnessId('claude')]);

  const plan = await planGitNexusManagedMcpActivation(windows, harnessId('claude'));
  assert.equal(plan.actions.length, 2);
  const install = plan.actions[0];
  assert.ok(install?.kind === 'package-manager-install');
  assert.equal(install.packageManager, 'npm');
  assert.equal(install.packageName, 'gitnexus');
  assert.equal(install.version, GITNEXUS_REVIEWED_MCP_VERSION);
  assert.equal(plan.actions[1]?.kind, 'merge-json');
  assert.ok(commands.includes('npm --version'));
});

test('Windows first-run explains npm as the missing prerequisite instead of a generic setup surface', async () => {
  const fs = new MemoryFs();
  const commands: string[] = [];
  const base = context(fs, commands);
  const windows = {
    ...base,
    facts: { ...FACTS, os: 'windows' as const, osDisplayName: 'Windows 11' },
    runner: absentGitNexusRunner(commands, false),
  };

  const detection = await gitnexusManagedProviderAdapter.detect(windows);
  assert.deepEqual(detection.assignableHarnesses, []);
  assert.equal(detection.warnings[0]?.code, 'gitnexus-npm-unavailable');
  assert.match(detection.warnings[0]?.message ?? '', /npm is not available/i);
});

test('keeps a newer GitNexus release usable when it still advertises MCP', async () => {
  const fs = new MemoryFs();
  setJson(fs, { theme: 'dark' });
  const commands: string[] = [];
  const base = context(fs, commands);

  const plan = await planGitNexusManagedMcpActivation(
    { ...base, runner: runner(commands, '1.9.0') },
    harnessId('claude'),
  );

  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.kind, 'merge-json');
  assert.deepEqual(commands, ['gitnexus --version', 'gitnexus --help']);
});

test('refuses to overwrite a brownfield GitNexus MCP entry', async () => {
  const fs = new MemoryFs();
  setJson(fs, {
    mcpServers: {
      gitnexus: { command: 'npx', args: ['-y', 'gitnexus@custom', 'mcp'] },
    },
  });

  const plan = await planGitNexusManagedMcpActivation(context(fs), harnessId('claude'));
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.diagnostics[0]?.code, 'gitnexus-mcp-entry-user-owned');
});

test('does not retroactively own an identical brownfield entry', async () => {
  const fs = new MemoryFs();
  setJson(fs, { mcpServers: { gitnexus: GITNEXUS_MCP_SERVER } });

  const plan = await planGitNexusManagedMcpActivation(context(fs), harnessId('claude'));
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.diagnostics[0]?.code, 'gitnexus-mcp-already-present');
  assert.match(plan.diagnostics[0]?.message ?? '', /user-owned/);
});

test('keeps Codex out until a surgical TOML ownership path exists', async () => {
  const fs = new MemoryFs();
  const plan = await planGitNexusManagedMcpActivation(context(fs), harnessId('codex'));
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.target, null);
  assert.equal(plan.diagnostics[0]?.code, 'gitnexus-managed-mcp-harness-unsupported');
});

test('verifies passively without starting MCP or indexing the repository', async () => {
  const fs = new MemoryFs();
  setJson(fs, { keep: true, mcpServers: { gitnexus: GITNEXUS_MCP_SERVER } });
  const commands: string[] = [];

  const verification = await verifyGitNexusManagedMcpActivation(
    context(fs, commands),
    harnessId('claude'),
  );
  assert.equal(verification.state, 'verified');
  assert.deepEqual(commands, ['gitnexus --version', 'gitnexus --help']);
  assert.equal(
    commands.some((command) => /\b(setup|mcp|analyze)\b/.test(command)),
    false,
  );
});

test('builds surgical removal only from the exact owned JSON receipt', () => {
  const fs = new MemoryFs();
  const base = context(fs);
  const owned = {
    kind: 'owned-json-entry' as const,
    path: '/home/dev/.claude.json',
    pointer: GITNEXUS_CLAUDE_MCP_POINTER,
    placement: 'value' as const,
    valueDigest: jsonValueDigest(GITNEXUS_MCP_SERVER),
  };

  const removal = planGitNexusManagedMcpRemoval(base, owned);
  assert.equal(removal.actions.length, 1);
  const action = removal.actions[0];
  assert.ok(action?.kind === 'remove-owned-change');
  assert.deepEqual(action.target, owned);
  assert.equal(action.rollbackData, 'file-snapshot');

  const wrong = planGitNexusManagedMcpRemoval(base, {
    ...owned,
    valueDigest: jsonValueDigest({ command: 'changed' }),
  });
  assert.deepEqual(wrong.actions, []);
  assert.equal(wrong.diagnostics[0]?.code, 'gitnexus-mcp-ownership-mismatch');
});

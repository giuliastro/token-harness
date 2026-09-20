import assert from 'node:assert/strict';
import test from 'node:test';

import {
  harnessId,
  type FileStat,
  type FileSystemPort,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';

import {
  HEADROOM_CLAUDE_MCP_POINTER,
  HEADROOM_CODEX_MARKER_BEGIN,
  HEADROOM_CODEX_MCP_BODY,
  HEADROOM_MCP_SERVER,
  HEADROOM_REVIEWED_MCP_VERSION,
  headroomManagedProviderAdapter,
  planHeadroomManagedMcpActivation,
  verifyHeadroomManagedMcpActivation,
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

function successfulOutcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: '/usr/local/bin/headroom',
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

function runner(commands: string[] = [], version = '0.37.0'): ProcessRunner {
  return {
    run: (request) => {
      commands.push(`${request.executable} ${request.args.join(' ')}`);
      if (request.args[0] === '--version') {
        return Promise.resolve(successfulOutcome(request, `headroom ${version}`));
      }
      if (request.args[0] === 'wrap' && request.args[1] === '--help') {
        return Promise.resolve(successfulOutcome(request, 'Supported: claude codex aider'));
      }
      if (
        request.args[0] === 'mcp' &&
        request.args[1] === 'serve' &&
        request.args[2] === '--help'
      ) {
        return Promise.resolve(successfulOutcome(request, 'Run the local Headroom MCP server'));
      }
      throw new Error(`unexpected command ${request.args.join(' ')}`);
    },
  };
}

function absentHeadroomRunner(commands: string[] = [], uvAvailable = true): ProcessRunner {
  return {
    run: (request) => {
      commands.push(`${request.executable} ${request.args.join(' ')}`);
      if (request.executable === 'uv' && request.args[0] === '--version' && uvAvailable) {
        return Promise.resolve(successfulOutcome(request, 'uv 0.8.17'));
      }
      return Promise.resolve({
        ...successfulOutcome(request, ''),
        executablePath: null,
        exitCode: null,
        failure: { reason: 'executable-not-found' as const, message: `${request.executable} missing` },
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
    now: () => '2026-09-17T11:15:00.000Z',
    localDatabase: null,
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

const ENCODER = new TextEncoder();

test('plans the reviewed Headroom MCP entry in the modern Claude Code user config', async () => {
  const fs = new MemoryFs();
  const plan = await planHeadroomManagedMcpActivation(context(fs), harnessId('claude'));

  assert.equal(plan.target, '/home/dev/.claude.json');
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0];
  assert.ok(action?.kind === 'merge-json');
  assert.equal(action.path, '/home/dev/.claude.json');
  assert.deepEqual(action.ownedPointers, [HEADROOM_CLAUDE_MCP_POINTER]);
  assert.deepEqual(action.operations, [
    {
      kind: 'set',
      pointer: HEADROOM_CLAUDE_MCP_POINTER,
      value: HEADROOM_MCP_SERVER,
      expectedValueDigest: null,
    },
  ]);
  assert.equal(
    plan.actions.some((entry) => entry.affectedPaths.includes('/home/dev/.claude/mcp.json')),
    false,
  );
});

test('Windows first-run can install reviewed Headroom through uv and configure Claude', async () => {
  const fs = new MemoryFs();
  const commands: string[] = [];
  const base = context(fs, commands);
  const windows = {
    ...base,
    facts: { ...FACTS, os: 'windows' as const, osDisplayName: 'Windows 11' },
    runner: absentHeadroomRunner(commands),
  };

  const detection = await headroomManagedProviderAdapter.detect(windows);
  assert.equal(detection.state, 'absent');
  assert.deepEqual(detection.assignableHarnesses, [harnessId('claude'), harnessId('codex')]);

  const plan = await planHeadroomManagedMcpActivation(windows, harnessId('claude'));
  assert.equal(plan.actions.length, 2);
  const install = plan.actions[0];
  assert.ok(install?.kind === 'package-manager-install');
  assert.equal(install.packageManager, 'uv');
  assert.equal(install.packageName, 'headroom-ai[mcp]');
  assert.equal(install.version, HEADROOM_REVIEWED_MCP_VERSION);
  assert.equal(install.rollbackData, 'package-inventory');
  assert.equal(plan.actions[1]?.kind, 'merge-json');
  assert.ok(commands.includes('uv --version'));
});

test('Windows first-run names uv when Headroom cannot be installed automatically', async () => {
  const fs = new MemoryFs();
  const commands: string[] = [];
  const base = context(fs, commands);
  const windows = {
    ...base,
    facts: { ...FACTS, os: 'windows' as const, osDisplayName: 'Windows 11' },
    runner: absentHeadroomRunner(commands, false),
  };

  const detection = await headroomManagedProviderAdapter.detect(windows);
  assert.deepEqual(detection.assignableHarnesses, []);
  assert.equal(detection.warnings[0]?.code, 'headroom-uv-install-prerequisite');
  assert.match(detection.warnings[0]?.remediation ?? '', /uv/i);
});

test('keeps a newer Headroom release usable when its MCP server command still exists', async () => {
  const fs = new MemoryFs();
  const base = context(fs);
  const commands: string[] = [];
  const plan = await planHeadroomManagedMcpActivation(
    { ...base, runner: runner(commands, '0.50.0') },
    harnessId('claude'),
  );

  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.kind, 'merge-json');
  assert.deepEqual(commands, [
    'headroom --version',
    'headroom wrap --help',
    'headroom mcp serve --help',
  ]);
});

test('plans a reversible Codex marker block without running wrap or proxy commands', async () => {
  const fs = new MemoryFs();
  const commands: string[] = [];
  const plan = await planHeadroomManagedMcpActivation(context(fs, commands), harnessId('codex'));

  assert.equal(plan.target, '/home/dev/.codex/config.toml');
  const patch = plan.actions.find((action) => action.kind === 'patch-marker-block');
  assert.ok(patch?.kind === 'patch-marker-block');
  assert.equal(patch.path, '/home/dev/.codex/config.toml');
  assert.equal(patch.markerBegin, HEADROOM_CODEX_MARKER_BEGIN);
  assert.equal(patch.body, HEADROOM_CODEX_MCP_BODY);
  assert.ok(plan.actions.some((action) => action.kind === 'create-directory'));
  assert.deepEqual(commands, [
    'headroom --version',
    'headroom wrap --help',
    'headroom mcp serve --help',
  ]);
  assert.equal(
    commands.some((command) => /headroom (?:proxy|deploy)(?: |$)/.test(command)),
    false,
  );
});

test('leaves a conflicting user-owned Claude Headroom MCP entry untouched', async () => {
  const fs = new MemoryFs();
  fs.files.set(
    '/home/dev/.claude.json',
    ENCODER.encode(
      JSON.stringify({
        mcpServers: {
          headroom: { command: '/custom/headroom', args: ['serve-custom'] },
        },
      }),
    ),
  );

  const plan = await planHeadroomManagedMcpActivation(context(fs), harnessId('claude'));
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.diagnostics[0]?.code, 'headroom-claude-mcp-user-owned');
});

test('verifies the exact reviewed Claude MCP registration without starting the server', async () => {
  const fs = new MemoryFs();
  fs.files.set(
    '/home/dev/.claude.json',
    ENCODER.encode(JSON.stringify({ mcpServers: { headroom: HEADROOM_MCP_SERVER } })),
  );
  const commands: string[] = [];

  const verification = await verifyHeadroomManagedMcpActivation(
    context(fs, commands),
    harnessId('claude'),
  );

  assert.equal(verification.state, 'verified');
  assert.equal(verification.target, '/home/dev/.claude.json');
  assert.deepEqual(commands, [
    'headroom --version',
    'headroom wrap --help',
    'headroom mcp serve --help',
  ]);
  assert.equal(commands.includes('headroom mcp serve'), false);
});

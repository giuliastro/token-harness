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
  MCPTOON_AGENT_INSTRUCTIONS,
  MCPTOON_CLAUDE_SKILL,
  MCPTOON_MARKER_BEGIN,
  MCPTOON_MARKER_END,
  MCPTOON_REVIEWED_INSTALL_VERSION,
  planMcptoonManagedActivation,
  verifyMcptoonManagedActivation,
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

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: '/usr/local/bin/mcptoon',
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

function runner(commands: string[] = []): ProcessRunner {
  return {
    run: (request) => {
      commands.push(`${request.executable} ${request.args.join(' ')}`);
      if (request.args[0] === '--version') {
        return Promise.resolve(outcome(request, 'mcptoon 0.7.8'));
      }
      if (request.args[0] === '--help') {
        return Promise.resolve(outcome(request, 'Options: --compact --json --toon'));
      }
      throw new Error(`unexpected command ${request.args.join(' ')}`);
    },
  };
}

function absentMcptoonRunner(pipxAvailable = true): ProcessRunner {
  return {
    run: (request) => {
      const pipx = request.executable === 'pipx' && pipxAvailable;
      return Promise.resolve({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: pipx ? '/usr/bin/pipx' : null,
        exitCode: pipx ? 0 : null,
        signal: null,
        stdout: pipx ? '1.7.1' : '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: pipx
          ? null
          : { reason: 'executable-not-found', message: `${request.executable} missing` },
      });
    },
  };
}

function context(fs: MemoryFs): ProviderContext {
  return {
    fs,
    runner: runner(),
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
    now: () => '2026-09-13T08:30:00.000Z',
    localDatabase: null,
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

const ENCODER = new TextEncoder();

function reviewedCodexInstructions(): Uint8Array {
  return ENCODER.encode(
    [
      '# Existing user instructions',
      `<!-- ${MCPTOON_MARKER_BEGIN} -->`,
      MCPTOON_AGENT_INSTRUCTIONS.trimEnd(),
      `<!-- ${MCPTOON_MARKER_END} -->`,
      '',
    ].join('\n'),
  );
}

test('plans a Token Harness-owned Claude skill without touching mcptoon config', async () => {
  const fs = new MemoryFs();
  const plan = await planMcptoonManagedActivation(context(fs), harnessId('claude'));

  assert.equal(plan.target, '/home/dev/.claude/skills/mcptoon/SKILL.md');
  assert.equal(plan.actions.at(-1)?.kind, 'write-owned-file');
  const write = plan.actions.at(-1);
  assert.ok(write?.kind === 'write-owned-file');
  assert.equal(write.content, MCPTOON_CLAUDE_SKILL);
  assert.equal(write.expectedDigest, null);
  assert.equal(
    plan.actions.some((action) => action.affectedPaths.includes('/home/dev/.mcptoon/config.json')),
    false,
  );
});

test('plans a surgical Codex AGENTS marker block', async () => {
  const fs = new MemoryFs();
  fs.files.set('/work/demo/AGENTS.md', ENCODER.encode('# Existing user instructions\n'));

  const plan = await planMcptoonManagedActivation(context(fs), harnessId('codex'));
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0];
  assert.ok(action?.kind === 'patch-marker-block');
  assert.equal(action.path, '/work/demo/AGENTS.md');
  assert.equal(action.markerBegin, MCPTOON_MARKER_BEGIN);
  assert.equal(action.markerEnd, MCPTOON_MARKER_END);
  assert.equal(action.body, MCPTOON_AGENT_INSTRUCTIONS.trimEnd());
  assert.equal(action.createIfMissing, true);
});

test('does not overwrite an existing non-reviewed mcptoon marker block', async () => {
  const fs = new MemoryFs();
  fs.files.set(
    '/work/demo/AGENTS.md',
    ENCODER.encode(`<!-- ${MCPTOON_MARKER_BEGIN} -->\ncustom\n<!-- ${MCPTOON_MARKER_END} -->\n`),
  );

  const plan = await planMcptoonManagedActivation(context(fs), harnessId('codex'));
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.diagnostics[0]?.code, 'mcptoon-guidance-user-owned');
});

test('verifies reviewed Codex instructions without querying configured MCP servers', async () => {
  const fs = new MemoryFs();
  fs.files.set('/work/demo/AGENTS.md', reviewedCodexInstructions());
  const commands: string[] = [];
  const base = context(fs);

  const verification = await verifyMcptoonManagedActivation(
    { ...base, runner: runner(commands) },
    harnessId('codex'),
  );
  assert.equal(verification.state, 'verified');
  assert.equal(verification.target, '/work/demo/AGENTS.md');
  assert.deepEqual(commands, ['mcptoon --version', 'mcptoon --help']);
});

test('plans reviewed pipx installation before Codex guidance when mcptoon is absent', async () => {
  const fs = new MemoryFs();
  const base = context(fs);
  const plan = await planMcptoonManagedActivation(
    { ...base, runner: absentMcptoonRunner() },
    harnessId('codex'),
  );

  assert.equal(plan.actions.length, 2);
  const install = plan.actions[0];
  assert.ok(install?.kind === 'package-manager-install');
  assert.equal(install.packageManager, 'pipx');
  assert.equal(install.packageName, 'mcptoon');
  assert.equal(install.version, MCPTOON_REVIEWED_INSTALL_VERSION);
  assert.equal(install.rollbackData, 'package-inventory');
  assert.equal(plan.actions[1]?.kind, 'patch-marker-block');
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-managed-install-planned'));
});

test('does not install mcptoon when the Codex activation surface is in conflict', async () => {
  const fs = new MemoryFs();
  fs.files.set(
    '/work/demo/AGENTS.md',
    ENCODER.encode(`<!-- ${MCPTOON_MARKER_BEGIN} -->\ncustom\n<!-- ${MCPTOON_MARKER_END} -->\n`),
  );
  const base = context(fs);

  const plan = await planMcptoonManagedActivation(
    { ...base, runner: absentMcptoonRunner() },
    harnessId('codex'),
  );

  assert.deepEqual(plan.actions, []);
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-guidance-user-owned'));
  assert.equal(
    plan.diagnostics.some((entry) => entry.code === 'mcptoon-managed-install-planned'),
    false,
  );
});

test('installs only the package when reviewed Codex guidance is already present', async () => {
  const fs = new MemoryFs();
  fs.files.set('/work/demo/AGENTS.md', reviewedCodexInstructions());
  const base = context(fs);

  const plan = await planMcptoonManagedActivation(
    { ...base, runner: absentMcptoonRunner() },
    harnessId('codex'),
  );

  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.kind, 'package-manager-install');
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-guidance-already-present'));
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-managed-install-planned'));
});

test('refuses managed installation when pipx is unavailable', async () => {
  const fs = new MemoryFs();
  const base = context(fs);
  const plan = await planMcptoonManagedActivation(
    { ...base, runner: absentMcptoonRunner(false) },
    harnessId('codex'),
  );

  assert.deepEqual(plan.actions, []);
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-pipx-unavailable'));
});

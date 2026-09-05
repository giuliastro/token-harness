import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  deriveProjectId,
  type NativeConfigurationEnvironment,
  type ProcessRequest,
  type ProcessOutcome,
  type ProcessRunner,
  type PlatformFacts,
  type PlanReport,
  type CliEnvelope,
  type ApplyReport,
  type CompatibilityRow,
  harnessId,
  providerId,
} from '@token-harness/core';
import { FIXTURES_ROOT } from '@token-harness/tests';
import { NodeFileSystem } from '@token-harness/platform';
import { run } from 'token-harness';

const root = mkdtempSync(join(tmpdir(), 'th-claude-policy-'));
after(() => rmSync(root, { recursive: true, force: true }));
const facts: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  arch: 'x64',
  isWsl: false,
  osDisplayName: 'test',
  nodeVersion: process.versions.node,
};
const emptyEnvironment: NativeConfigurationEnvironment = {
  claudeConfigDirectory: null,
  codexConfigDirectory: null,
  claudeEffortOverridden: false,
  claudeModelOverridden: false,
  claudeBackendOverridden: false,
};
let serial = 0;
function world(
  contents:
    | string
    | null = '{\r\n  "effortLevel": "high",\r\n  "permissions": {"allow": ["Read"]}\r\n}\r\n',
) {
  const folder = join(root, String(++serial));
  const home = join(folder, 'home');
  const project = join(folder, 'project');
  const state = join(folder, 'state');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(project, '.claude'), { recursive: true });
  mkdirSync(state, { recursive: true });
  const config = join(home, '.claude', 'settings.json');
  if (contents !== null) writeFileSync(config, contents);
  return {
    home,
    project,
    state,
    config,
    version: '2.1.261',
    providersPresent: false,
    environment: { ...emptyEnvironment },
    environmentObserved: true,
    clock: Date.parse('2026-09-05T17:00:00Z'),
    calls: [] as ProcessRequest[],
  };
}
type World = ReturnType<typeof world>;
function outcome(request: ProcessRequest, text: string | null): ProcessOutcome {
  return {
    displayCommand: request.executable,
    interpreter: 'direct',
    executablePath: text === null ? null : '/fake/claude',
    exitCode: text === null ? null : 0,
    signal: null,
    stdout: text ?? '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: text === null ? { reason: 'executable-not-found', message: 'missing' } : null,
  };
}
function runner(w: World): ProcessRunner {
  return {
    ...(w.environmentObserved
      ? { readNativeConfigurationEnvironment: () => ({ ...w.environment }) }
      : {}),
    async run(request) {
      w.calls.push(request);
      if (w.providersPresent) {
        if (request.executable === 'rtk' && request.args[0] === '--version')
          return outcome(request, 'rtk 0.44.0');
        if (request.executable === 'harnesstrim' && request.args[0] === '--version')
          return outcome(request, '0.1.0');
        if (request.executable === 'harnesstrim' && request.args[0] === 'capabilities')
          return outcome(
            request,
            readFileSync(join(FIXTURES_ROOT, 'providers/harnesstrim-capabilities.json'), 'utf8'),
          );
        if (request.executable === 'codex' && request.args[0] === '--version')
          return outcome(request, 'codex-cli 0.146.0');
        // No provider install may run while applying the Claude-only stored action.
        if (request.args[0] === 'install') throw new Error('unreviewed provider install');
      }
      if (request.executable !== 'claude') return outcome(request, null);
      if (request.args[0] === '--version') return outcome(request, w.version + ' (Claude Code)');
      if (request.args[0] === '--help')
        return outcome(
          request,
          '--effort <level>   Effort level for the current session\n (low, medium, high, xhigh, max)',
        );
      if (request.args[0] === 'mcp') return outcome(request, '');
      throw new Error('unexpected Claude invocation: ' + request.args.join(' '));
    },
  };
}
async function invoke<T>(w: World, argv: string[]) {
  let output = '';
  const code = await run({
    argv: [...argv, '--json'],
    streams: {
      out: (text) => {
        output += text;
      },
      err: () => undefined,
    },
    platform: facts,
    cwd: w.project,
    home: w.home,
    stateRoot: w.state,
    now: () => new Date(w.clock++).toISOString(),
    metrics: null,
    compatibilityRows: w.providersPresent
      ? [
          {
            harness: harnessId('codex'),
            harnessVersion: { minimum: '0.146.0', maximum: '0.146.0' },
            provider: providerId('harnesstrim'),
            providerVersion: '0.1.0',
            platform: { os: facts.os, wsl: false, supported: true, limitation: null },
            configSchema: 'fake-skills',
            fixture: 'test-only-scope-replay',
            verificationTier: 'config-only',
          } satisfies CompatibilityRow,
        ]
      : null,
    adapters: {
      fs: new NodeFileSystem(facts),
      runner: runner(w),
      localDatabase: null,
      paths: {
        home: w.home,
        config: join(w.home, 'config'),
        data: join(w.home, 'data'),
        state: w.state,
        cache: join(w.home, 'cache'),
      },
      projectIdFor: (path) => deriveProjectId(path, 'a'.repeat(64), facts.os === 'windows'),
    },
  });
  return { code, envelope: JSON.parse(output) as CliEnvelope<T> };
}
async function plan(w: World, task = 'mechanical', profile = 'economy') {
  return invoke<PlanReport>(w, [
    'plan',
    '--harness',
    'claude',
    '--provider',
    'none',
    '--native-policy',
    '--task',
    task,
    '--profile',
    profile,
  ]);
}
async function apply(w: World, id: string) {
  return invoke<ApplyReport>(w, ['apply', '--yes', '--plan', id]);
}

function multiHarnessWorld() {
  const w = world(
    JSON.stringify({
      effortLevel: 'high',
      hooks: {
        PreToolUse: ['Bash', 'PowerShell'].map((matcher) => ({
          matcher,
          hooks: [{ type: 'command', command: 'rtk hook claude' }],
        })),
      },
    }),
  );
  w.providersPresent = true;
  return w;
}

describe('stored native plans do not require repeating selectors', () => {
  it('replays the exact reported Claude command with Codex, RTK and HarnessTrim present', async () => {
    const w = multiHarnessWorld();
    const p = await invoke<PlanReport>(w, [
      'plan',
      '--harness',
      'claude',
      '--native-policy',
      '--task',
      'mechanical',
      '--profile',
      'economy',
    ]);
    assert.equal(p.code, 0, JSON.stringify(p.envelope.diagnostics));
    assert.equal(p.envelope.data?.actions.length, 1);
    assert.ok(p.envelope.data?.ownership.every((item) => item.scope.harness === 'claude'));
    const id = p.envelope.data?.planId;
    assert.ok(id);
    w.calls.length = 0;
    const applied = await apply(w, id);
    assert.equal(applied.code, 0, JSON.stringify(applied.envelope.diagnostics));
    assert.equal(applied.envelope.data?.fromStoredPlan, true);
    assert.equal(applied.envelope.data?.results.length, 1);
    assert.equal(JSON.parse(readFileSync(w.config, 'utf8')).effortLevel, 'low');
    assert.ok(w.calls.every((call) => call.executable !== 'codex'));
    assert.ok(w.calls.every((call) => call.args[0] !== 'install'));
  });
  it('restores a provider-free plan instead of introducing installed providers during replay', async () => {
    const w = multiHarnessWorld();
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    w.calls.length = 0;
    const applied = await apply(w, id);
    assert.equal(applied.code, 0, JSON.stringify(applied.envelope.diagnostics));
    assert.equal(JSON.parse(readFileSync(w.config, 'utf8')).effortLevel, 'low');
    assert.ok(w.calls.every((call) => !['rtk', 'harnesstrim', 'codex'].includes(call.executable)));
  });
  it('rejects an explicit conflicting provider without probing excluded agents', async () => {
    const w = multiHarnessWorld();
    const original = readFileSync(w.config, 'utf8');
    const id = (await plan(w)).envelope.data?.planId;
    assert.ok(id);
    w.calls.length = 0;
    const applied = await invoke<ApplyReport>(w, [
      'apply',
      '--plan',
      id,
      '--yes',
      '--provider',
      'rtk',
    ]);
    assert.equal(applied.code, 5);
    assert.ok(applied.envelope.diagnostics.some((item) => item.code === 'plan-selection-mismatch'));
    assert.equal(w.calls.length, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
  });
  it('rejects a malformed artifact before probing agents or changing settings', async () => {
    const w = multiHarnessWorld();
    const original = readFileSync(w.config, 'utf8');
    const id = (await plan(w)).envelope.data?.planId;
    assert.ok(id);
    writeFileSync(join(w.state, 'plans', id + '.json'), 'null');
    w.calls.length = 0;
    const applied = await apply(w, id);
    assert.equal(applied.code, 2);
    assert.equal(w.calls.length, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
  });
  it('rejects a valid artifact stored under a different requested id', async () => {
    const w = multiHarnessWorld();
    const original = readFileSync(w.config, 'utf8');
    const id = (await plan(w)).envelope.data?.planId;
    assert.ok(id);
    writeFileSync(
      join(w.state, 'plans', 'deadbeef.json'),
      readFileSync(join(w.state, 'plans', id + '.json')),
    );
    w.calls.length = 0;
    const applied = await apply(w, 'deadbeef');
    assert.equal(applied.code, 5);
    assert.ok(applied.envelope.diagnostics.some((item) => item.code === 'plan-digest-mismatch'));
    assert.equal(w.calls.length, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
  });
  it('rejects an explicit conflicting harness without mutating either configuration', async () => {
    const w = multiHarnessWorld();
    const original = readFileSync(w.config, 'utf8');
    const id = (await plan(w)).envelope.data?.planId;
    assert.ok(id);
    const applied = await invoke<ApplyReport>(w, [
      'apply',
      '--plan',
      id,
      '--yes',
      '--harness',
      'codex',
    ]);
    assert.equal(applied.code, 5);
    assert.ok(applied.envelope.diagnostics.some((item) => item.code === 'plan-selection-mismatch'));
    assert.equal(readFileSync(w.config, 'utf8'), original);
  });
});

describe('Claude native effort policy through public plan/apply', () => {
  it('plans without mutation, applies only effort, and rollback restores exact original bytes', async () => {
    const w = world();
    const original = readFileSync(w.config, 'utf8');
    const p = await plan(w);
    assert.equal(p.code, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    const action = p.envelope.data?.actions[0];
    assert.equal(action?.kind, 'merge-json');
    if (action?.kind !== 'merge-json') throw new Error('expected native JSON action');
    assert.deepEqual(action.ownedPointers, ['effortLevel']);
    const applied = await apply(w, id);
    assert.equal(applied.code, 0);
    assert.equal(applied.envelope.data?.outcome, 'committed');
    const actual = JSON.parse(readFileSync(w.config, 'utf8')) as Record<string, unknown>;
    assert.equal(actual['effortLevel'], 'low');
    assert.deepEqual(actual['permissions'], { allow: ['Read'] });
    const undone = await invoke(w, ['rollback', '--yes']);
    assert.equal(undone.code, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
    assert.ok(w.calls.every((call) => !call.args.includes('-p') && !call.args.includes('login')));
  });
  it('uninstall restores a pre-existing effort rather than deleting the user choice', async () => {
    const w = world();
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    assert.equal((await apply(w, id)).code, 0);
    assert.equal((await invoke(w, ['uninstall', '--yes'])).code, 0);
    assert.equal(JSON.parse(readFileSync(w.config, 'utf8')).effortLevel, 'high');
  });
  it('creates an absent preference file and rollback restores its absence', async () => {
    const w = world(null);
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    assert.equal((await apply(w, id)).code, 0);
    assert.equal(existsSync(w.config), true);
    assert.equal((await invoke(w, ['rollback', '--yes'])).code, 0);
    assert.equal(existsSync(w.config), false);
  });
  for (const target of ['project', 'local']) {
    it('refuses a ' + target + ' effort override', async () => {
      const w = world();
      writeFileSync(
        join(w.project, '.claude', target === 'project' ? 'settings.json' : 'settings.local.json'),
        '{"effortLevel":"xhigh"}',
      );
      const p = await plan(w);
      assert.equal(p.envelope.data?.actions.length, 0);
      assert.ok(p.envelope.diagnostics.some((d) => d.code === 'claude-native-policy-blocked'));
    });
  }
  it('rejects project config created between review and apply', async () => {
    const w = world();
    const original = readFileSync(w.config, 'utf8');
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    writeFileSync(join(w.project, '.claude', 'settings.local.json'), '{"effortLevel":"xhigh"}');
    assert.notEqual((await apply(w, id)).code, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
  });
  it('rejects environment drift between review and apply', async () => {
    const w = world();
    const original = readFileSync(w.config, 'utf8');
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    w.environment.claudeEffortOverridden = true;
    assert.notEqual((await apply(w, id)).code, 0);
    assert.equal(readFileSync(w.config, 'utf8'), original);
  });
  it('refuses an unknown environment, comments, unknown values, or unreviewed versions', async () => {
    const cases = [
      world(),
      world('{/* private comment */"effortLevel":"high"}'),
      world('{"effortLevel":"future"}'),
      world(),
    ];
    cases[0]!.environmentObserved = false;
    cases[3]!.version = '2.1.999';
    for (const w of cases) assert.equal((await plan(w)).envelope.data?.actions.length, 0);
  });
  it('requires an explicit task; critical work never gets low effort or persisted max', async () => {
    const w = world();
    assert.equal(
      (
        await invoke<PlanReport>(w, [
          'plan',
          '--harness',
          'claude',
          '--provider',
          'none',
          '--native-policy',
        ])
      ).envelope.data?.actions.length,
      0,
    );
    const p = await plan(w, 'critical', 'quality');
    const action = p.envelope.data?.actions[0];
    assert.equal(action?.kind, 'merge-json');
    if (action?.kind !== 'merge-json') throw new Error('missing action');
    assert.equal(action.operations[0]?.kind, 'set');
    assert.equal((action.operations[0] as { value: unknown }).value, 'xhigh');
  });
  it('restores the original user preference after several managed changes', async () => {
    const w = world('{"effortLevel":"medium","unrelated":true}');
    for (const [task, profile] of [
      ['mechanical', 'economy'],
      ['critical', 'quality'],
    ]) {
      const p = await plan(w, task, profile);
      const id = p.envelope.data?.planId;
      assert.ok(id);
      assert.equal((await apply(w, id)).code, 0);
    }
    assert.equal((await invoke(w, ['uninstall', '--yes'])).code, 0);
    assert.equal(JSON.parse(readFileSync(w.config, 'utf8')).effortLevel, 'medium');
    assert.equal(JSON.parse(readFileSync(w.config, 'utf8')).unrelated, true);
    assert.equal((await invoke(w, ['uninstall', '--yes'])).code, 0);
    assert.equal(JSON.parse(readFileSync(w.config, 'utf8')).effortLevel, 'medium');
  });

  it('does not overwrite a manual effort edit during uninstall', async () => {
    const w = world();
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    assert.equal((await apply(w, id)).code, 0);
    writeFileSync(w.config, '{"effortLevel":"medium","manual":true}');
    const before = readFileSync(w.config, 'utf8');
    await invoke(w, ['uninstall', '--yes']);
    assert.equal(readFileSync(w.config, 'utf8'), before);
  });
  it('refuses version drift after review', async () => {
    const w = world();
    const before = readFileSync(w.config, 'utf8');
    const p = await plan(w);
    const id = p.envelope.data?.planId;
    assert.ok(id);
    w.version = '2.1.262';
    assert.notEqual((await apply(w, id)).code, 0);
    assert.equal(readFileSync(w.config, 'utf8'), before);
  });
  it('leaves thinking-disabled and settings-level custom backend controls untouched', async () => {
    for (const config of [
      '{"alwaysThinkingEnabled":false}',
      '{"env":{"anthropic_base_url":"https://custom.invalid"}}',
      '{"env":{"ANTHROPIC_API_KEY":"private-test-value"}}',
    ]) {
      const w = world(config);
      assert.equal((await plan(w)).envelope.data?.actions.length, 0);
      assert.equal(readFileSync(w.config, 'utf8'), config);
    }
  });
});

/** Controlled fake-provider tasks through public capture -> optimize -> plan/apply/rollback. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  deriveProjectId,
  type ApplyReport,
  type CliEnvelope,
  type ContextReport,
  type OptimizeReport,
  type PlanReport,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
  type TaskBenchmarkCaptureStartReport,
  type TaskBenchmarkCaptureFinishReport,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';

const ROOT = mkdtempSync(join(tmpdir(), 'th-outcome-native-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
let serial = 0;
function world(harness: 'claude' | 'codex') {
  const root = join(ROOT, String(++serial));
  const home = join(root, 'home');
  const project = join(root, 'project');
  const state = join(root, 'state');
  mkdirSync(join(home, '.' + harness), { recursive: true });
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(state, { recursive: true });
  const config = join(home, '.' + harness, harness === 'claude' ? 'settings.json' : 'config.toml');
  const w = {
    harness,
    home,
    project,
    state,
    config,
    model: harness === 'claude' ? 'claude-fixture-20260901' : 'codex-fixture-20260901',
    effort: 'high',
    verbosity: 'low',
    configVersion: 1,
    now: Date.parse('2026-09-06T08:00:00.000Z'),
    inputTokens: 10,
    lastActivity: '2026-09-06T07:50:00.000Z',
    five: 20,
    week: 10 as number | null,
    calls: [] as ProcessRequest[],
    contextReads: 0,
    changeOnContext: null as null | { read: number; field: 'model' | 'verbosity'; value: string },
  };
  save(w);
  return w;
}
type World = ReturnType<typeof world>;
function save(w: World) {
  const text =
    w.harness === 'claude'
      ? JSON.stringify(
          { model: w.model, effortLevel: w.effort, permissions: { allow: ['Read'] } },
          null,
          2,
        ) + '\n'
      : `model = "${w.model}"\nmodel_reasoning_effort = "${w.effort}"\nmodel_verbosity = "${w.verbosity}"\n# user comment\n`;
  writeFileSync(w.config, text);
}
function sync(w: World) {
  const text = readFileSync(w.config, 'utf8');
  if (w.harness === 'claude') {
    const parsed = JSON.parse(text) as { model: string; effortLevel: string };
    w.model = parsed.model;
    w.effort = parsed.effortLevel;
  } else {
    const value = (key: string) =>
      new RegExp('^' + key + ' = "([^"]*)"', 'm').exec(text)?.[1] ?? '';
    w.model = value('model');
    w.effort = value('model_reasoning_effort');
    w.verbosity = value('model_verbosity');
  }
}
function boundary(w: World) {
  w.contextReads++;
  if (w.changeOnContext?.read === w.contextReads) {
    w[w.changeOnContext.field] = w.changeOnContext.value;
    w.configVersion++;
    save(w);
  }
  sync(w);
}
function output(request: ProcessRequest, stdout: string | null): ProcessOutcome {
  return {
    displayCommand: request.executable,
    executablePath: stdout === null ? null : '/fake/' + request.executable,
    interpreter: 'direct',
    exitCode: stdout === null ? null : 0,
    signal: null,
    stdout: stdout ?? '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: stdout === null ? { reason: 'executable-not-found', message: 'not installed' } : null,
  };
}
function configRead(w: World, id: unknown) {
  sync(w);
  const source = {
    name: { type: 'user', file: w.config, profile: null },
    version: 'user-v' + String(w.configVersion),
  };
  return {
    id,
    result: {
      config: {
        model: w.model,
        model_reasoning_effort: w.effort,
        model_verbosity: w.verbosity,
        project_root_markers: ['.git'],
        project_doc_fallback_filenames: [],
      },
      origins: { model_reasoning_effort: source, model_verbosity: source },
      layers: [{ ...source, config: {} }],
    },
  };
}
function runner(w: World): ProcessRunner {
  return {
    readNativeConfigurationEnvironment: () => ({
      claudeConfigDirectory: null,
      codexConfigDirectory: null,
      claudeEffortOverridden: false,
      claudeModelOverridden: false,
      claudeBackendOverridden: false,
    }),
    async run(request) {
      w.calls.push(request);
      const reply = (data: unknown) => output(request, JSON.stringify(data));
      if (request.executable === 'ccusage') {
        if (request.args[0] === '--version') return output(request, 'ccusage 20.0.20');
        assert.equal(request.args[0], 'daily');
        return reply({
          daily: [],
          session: [
            {
              agent: w.harness,
              period: 'controlled-session',
              inputTokens: w.inputTokens,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
              totalTokens: w.inputTokens,
              modelsUsed: [w.model],
              metadata: {
                firstActivity: '2026-09-06T07:45:00.000Z',
                lastActivity: w.lastActivity,
              },
            },
          ],
        });
      }
      if (request.executable === 'cclimits' && w.harness === 'claude') {
        assert.deepEqual(request.args, [
          '--claude',
          '--json',
          '--no-cache-write',
          '--no-stale-fallback',
        ]);
        const window = (used: number, reset: string) => ({
          used: String(used) + '%',
          remaining: String(100 - used) + '%',
          resets_at: reset,
        });
        return reply({
          claude: {
            status: 'ok',
            source: 'claude_desktop_oauth',
            plan: 'pro',
            five_hour: window(w.five, '2026-09-06T13:00:00Z'),
            ...(w.week === null ? {} : { seven_day: window(w.week, '2026-09-10T12:00:00Z') }),
          },
        });
      }
      if (request.executable !== w.harness) return output(request, null);
      if (request.args[0] === '--version')
        return output(
          request,
          w.harness === 'claude' ? '2.1.261 (Claude Code)' : 'codex-cli 0.146.0',
        );
      if (w.harness === 'claude') {
        if (request.args[0] === '--help') {
          boundary(w);
          return output(request, '--effort <level> Effort level (low, medium, high, xhigh, max)');
        }
        if (request.args[0] === 'mcp') return output(request, '');
        throw new Error('No coding task may be executed');
      }
      assert.equal(request.args[0], 'app-server');
      const messages = (request.stdin ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const method = (name: string) => messages.find((message) => message['method'] === name);
      if (method('account/rateLimits/read')) {
        const window = (used: number, duration: number, reset: string) => ({
          usedPercent: used,
          windowDurationMins: duration,
          resetsAt: Date.parse(reset) / 1000,
        });
        return output(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify({
              id: 'token-harness-rate-limits',
              result: {
                rateLimits: {
                  limitId: 'included',
                  limitName: 'Included',
                  primary: window(w.five, 300, '2026-09-06T13:00:00Z'),
                  secondary: w.week === null ? null : window(w.week, 10080, '2026-09-10T12:00:00Z'),
                  planType: 'pro',
                  rateLimitReachedType: null,
                },
                rateLimitsByLimitId: null,
                rateLimitResetCredits: null,
              },
            }),
          ].join('\n'),
        );
      }
      const batch = method('config/batchWrite');
      if (batch) {
        const params = batch['params'] as {
          expectedVersion: string;
          filePath: string;
          edits: Array<{ keyPath: string; value: string }>;
        };
        assert.equal(params.expectedVersion, 'user-v' + String(w.configVersion));
        assert.equal(params.filePath, w.config);
        assert.deepEqual(
          params.edits.map((edit) => edit.keyPath),
          ['model_reasoning_effort'],
        );
        w.effort = params.edits[0]!.value;
        w.configVersion++;
        save(w);
        return output(
          request,
          [
            JSON.stringify({
              id: batch['id'],
              result: { version: 'user-v' + String(w.configVersion) },
            }),
            JSON.stringify(configRead(w, method('config/read')!['id'])),
          ].join('\n'),
        );
      }
      if (method('config/read')) {
        boundary(w);
        return output(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify(configRead(w, 2)),
            JSON.stringify({ id: 3, result: { data: [], nextCursor: null } }),
            JSON.stringify({
              id: 4,
              result: {
                data: [
                  {
                    id: w.model,
                    model: w.model,
                    displayName: 'Fixture',
                    modelSpecialty: null,
                    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(
                      (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }),
                    ),
                    defaultReasoningEffort: 'medium',
                    isDefault: true,
                  },
                ],
                nextCursor: null,
              },
            }),
          ].join('\n'),
        );
      }
      // Optional hook discovery has no execution or reduction evidence in this fixture.
      assert.ok(
        messages.every((message) =>
          ['initialize', 'initialized', 'hooks/list'].includes(String(message['method'])),
        ),
      );
      return output(request, '');
    },
  };
}
function options(w: World): Omit<RunOptions, 'argv' | 'streams'> {
  return {
    platform: FACTS,
    cwd: w.project,
    home: w.home,
    stateRoot: w.state,
    now: () => new Date(w.now).toISOString(),
    metrics: null,
    compatibilityRows: null,
    adapters: {
      fs: new NodeFileSystem(FACTS),
      runner: runner(w),
      localDatabase: null,
      paths: {
        home: w.home,
        config: join(w.home, 'config'),
        state: w.state,
        data: join(w.home, 'data'),
        cache: join(w.home, 'cache'),
      },
      projectIdFor: (path) => deriveProjectId(path, 'c'.repeat(64), FACTS.os === 'windows'),
    },
  };
}
async function invoke<T>(w: World, args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await run({
    ...options(w),
    argv: [...args, '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
  });
  assert.equal(stderr, '');
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { code, envelope, data: envelope.data };
}
async function record(
  w: World,
  id: string,
  variant: 'baseline' | 'optimized',
  task = 'hard',
  retries = false,
  changeModel = false,
) {
  w.effort = retries
    ? variant === 'baseline'
      ? 'medium'
      : 'high'
    : variant === 'baseline'
      ? 'high'
      : 'medium';
  save(w);
  const started = await invoke<TaskBenchmarkCaptureStartReport>(w, [
    'benchmark-start',
    '--benchmark-id',
    id,
    '--variant',
    variant,
    '--harness',
    w.harness,
    '--task',
    task,
  ]);
  assert.equal(started.code, 0, JSON.stringify(started.envelope.diagnostics));
  assert.equal(started.data!.capture.reasoningEffort, w.effort);
  assert.equal(started.data!.capture.model, w.model);
  w.now += 10 * 60_000;
  w.inputTokens += variant === 'baseline' ? 1000 : 700;
  w.lastActivity = new Date(w.now).toISOString();
  if (changeModel) {
    w.model += '-changed';
    save(w);
  }
  const finished = await invoke<TaskBenchmarkCaptureFinishReport>(w, [
    'benchmark-finish',
    '--benchmark-id',
    id,
    '--variant',
    variant,
    '--quality',
    'passed',
    '--attempts',
    retries && variant === 'baseline' ? '3' : '1',
    '--failed-attempts',
    retries && variant === 'baseline' ? '2' : '0',
  ]);
  assert.equal(finished.code, 0, JSON.stringify(finished.envelope.diagnostics));
  assert.equal(finished.data!.receipt.policyAtFinish!.model, w.model);
  assert.equal(finished.data!.receipt.policyAtFinish!.reasoningEffort, w.effort);
  assert.equal(finished.data!.receipt.policyAtFinish!.verification, 'config-only');
  assert.equal(finished.data!.receipt.localUsage!.totalTokens, variant === 'baseline' ? 1000 : 700);
  w.now += 5 * 60_000;
  return finished.data!.receipt;
}
async function train(w: World, retries = false) {
  for (let i = 0; i < 3; i++)
    for (const variant of ['baseline', 'optimized'] as const)
      await record(w, 'controlled-' + String(i), variant, retries ? 'standard' : 'hard', retries);
  w.now = Date.parse('2026-09-06T11:00:00.000Z');
  w.effort = retries ? 'medium' : 'high';
  save(w);
}
async function plan(w: World, task = 'hard') {
  return invoke<PlanReport>(w, [
    'plan',
    '--native-policy',
    '--provider',
    'none',
    '--harness',
    w.harness,
    '--task',
    task,
    '--profile',
    'balanced',
  ]);
}
async function advice(w: World, task = 'hard') {
  const result = await invoke<OptimizeReport>(w, [
    'optimize',
    '--harness',
    w.harness,
    '--task',
    task,
    '--profile',
    'balanced',
  ]);
  assert.equal(result.code, 0);
  return result.data!.harnesses[0]!;
}

for (const harness of ['codex', 'claude'] as const) {
  describe(harness + ' outcome-aware public workflow', () => {
    it('captures three pairs, learns an efficient effort, applies only after approval and rolls back exactly', async () => {
      const w = world(harness);
      await train(w);
      const original = readFileSync(w.config);
      const optimized = await advice(w);
      assert.equal(optimized.effortLearning!.state, 'learned');
      assert.equal(optimized.recommendedEffort, 'medium');
      assert.equal(
        optimized.effortLearning!.candidates.find((item) => item.effort === 'medium')!.bases[
          'local-tokens'
        ],
        3,
      );
      const planned = await plan(w);
      assert.equal(planned.code, 0, JSON.stringify(planned.envelope.diagnostics));
      assert.equal(planned.data!.actions.length, 1);
      const id = planned.data!.planId;
      assert.ok(id);
      assert.deepEqual(readFileSync(w.config), original);
      const refused = await invoke<ApplyReport>(w, ['apply', '--plan', id]);
      assert.equal(refused.code, 8);
      assert.deepEqual(readFileSync(w.config), original);
      const applied = await invoke<ApplyReport>(w, ['apply', '--yes', '--plan', id]);
      assert.equal(applied.code, 0, JSON.stringify(applied.envelope.diagnostics));
      sync(w);
      assert.equal(w.effort, 'medium');
      assert.equal(w.verbosity, 'low');
      assert.match(
        readFileSync(w.config, 'utf8'),
        harness === 'claude' ? /permissions/ : /# user comment/,
      );
      const rollback = await invoke(w, ['rollback', '--yes']);
      assert.equal(rollback.code, 0, JSON.stringify(rollback.envelope.diagnostics));
      assert.deepEqual(readFileSync(w.config), original);
      assert.ok(
        w.calls.every((call) => !['-p', 'exec', 'run', 'install'].includes(call.args[0] ?? '')),
      );
    });
    it('learns retry recovery but does not cross a missing or exhausted weekly allowance', async () => {
      const w = world(harness);
      await train(w, true);
      assert.equal((await advice(w, 'standard')).recommendedEffort, 'high');
      w.week = null;
      const unknown = await advice(w, 'standard');
      assert.equal(unknown.effortLearning!.state, 'deferred');
      assert.equal(unknown.recommendedEffort, null);
      const planned = await plan(w, 'standard');
      assert.equal(planned.data!.actions.length, 0);
      assert.ok(
        planned.envelope.diagnostics.some((item) => item.code === 'outcome-native-policy-deferred'),
      );
      w.week = 100;
      const exhausted = await advice(w, 'standard');
      assert.equal(exhausted.budgetDecision!.state, 'wait-for-reset');
      assert.notEqual(exhausted.recommendedEffort, 'high');
      // The pre-existing budget policy may still prepare a lower-effort future preference.
      // It must never turn exhaustion into the learned higher-effort retry recovery.
      assert.notEqual(exhausted.effortLearning!.state, 'learned');
    });
    it('captures end-policy drift rather than crediting it to a stable effort experiment', async () => {
      const w = world(harness);
      const row = await record(w, 'changed-policy', 'baseline', 'hard', false, true);
      assert.notEqual(row.model, row.policyAtFinish!.model);
      const optimized = await advice(w);
      assert.notEqual(optimized.effortLearning!.state, 'learned');
    });
    it('blocks model identity drift between learned advice and native plan', async () => {
      const w = world(harness);
      await train(w);
      w.contextReads = 0;
      w.changeOnContext = { read: 2, field: 'model', value: w.model + '-other' };
      const planned = await plan(w);
      assert.equal(planned.data!.actions.length, 0);
      assert.ok(
        planned.envelope.diagnostics.some((item) => item.code === 'outcome-native-policy-drift'),
        JSON.stringify(planned.envelope.diagnostics),
      );
    });
    it('does not authorize a learned policy from a corrupt project history', async () => {
      const w = world(harness);
      await train(w);
      writeFileSync(join(w.state, 'benchmarks', 'controlled-0', 'optimized.json'), '{');
      const optimized = await advice(w);
      assert.equal(optimized.effortLearning!.state, 'unavailable');
      assert.equal(optimized.recommendedEffort, 'high');
    });
  });
}
it('Codex verbosity drift blocks learned single-control advice', async () => {
  const w = world('codex');
  await train(w);
  w.contextReads = 0;
  w.changeOnContext = { read: 2, field: 'verbosity', value: 'high' };
  const planned = await plan(w);
  assert.equal(planned.data!.actions.length, 0);
  assert.ok(
    planned.envelope.diagnostics.some((item) => item.code === 'outcome-native-policy-drift'),
  );
});
it('Claude model identity is benchmark-only and never replaces the unobserved active model', async () => {
  const w = world('claude');
  const observed = await invoke<ContextReport>(w, ['context', '--harness', 'claude']);
  assert.equal(observed.data!.harnesses[0]!.model, null);
  assert.equal(observed.data!.harnesses[0]!.benchmarkPolicy!.model, w.model);
  w.model = 'sonnet';
  save(w);
  const alias = await invoke<ContextReport>(w, ['context', '--harness', 'claude']);
  assert.equal(alias.data!.harnesses[0]!.benchmarkPolicy, null);
});

it('rejects a passed finish with no successful attempt before observing any provider', async () => {
  const w = world('codex');
  const result = await invoke(w, [
    'benchmark-finish',
    '--benchmark-id',
    'invalid-attempts',
    '--variant',
    'baseline',
    '--quality',
    'passed',
    '--attempts',
    '2',
    '--failed-attempts',
    '2',
  ]);
  assert.equal(result.code, 2);
  assert.ok(
    result.envelope.diagnostics.some(
      (item) => item.code === 'benchmark-passed-without-successful-attempt',
    ),
  );
  assert.equal(w.calls.length, 0);
});

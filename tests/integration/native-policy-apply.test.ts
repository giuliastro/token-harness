/**
 * Phase 18.4 native Codex policy, end to end.
 *
 * This intentionally runs through the public CLI twice: first a persisted reviewed plan, then
 * apply --plan. The fake Codex runner is stateful enough to enforce expectedVersion and to return
 * the effective config after batchWrite, while the filesystem is real and isolated in tmp.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  deriveProjectId,
  type ApplyReport,
  type CliEnvelope,
  type PlanReport,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const NOW = '2026-09-01T18:00:00.000Z';
const SALT = 'f'.repeat(64);

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-native-policy-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface World {
  home: string;
  state: string;
  project: string;
  config: string;
  version: string;
  effort: string;
  verbosity: string;
}

function world(): World {
  counter += 1;
  const root = join(sandbox, 'w-' + String(counter));
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  const codex = join(home, '.codex');
  mkdirSync(codex, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });
  const config = join(codex, 'config.toml');
  writeFileSync(
    config,
    'model_reasoning_effort = "medium"\nmodel_verbosity = "medium"\n# user comment\n',
  );
  return {
    home,
    state,
    project,
    config,
    version: 'user-v1',
    effort: 'medium',
    verbosity: 'medium',
  };
}

function missing(request: ProcessRequest): ProcessOutcome {
  return {
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: { reason: 'executable-not-found', message: 'missing' },
  };
}

function success(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: '/fake/' + request.executable,
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

function configReadResult(place: World, id: string | number): Record<string, unknown> {
  return {
    id,
    result: {
      config: {
        model: 'gpt-5.6-codex',
        model_reasoning_effort: place.effort,
        model_verbosity: place.verbosity,
        project_root_markers: ['.git'],
        project_doc_fallback_filenames: [],
      },
      origins: {
        model_reasoning_effort: {
          name: { type: 'user', file: place.config, profile: null },
          version: place.version,
        },
        model_verbosity: {
          name: { type: 'user', file: place.config, profile: null },
          version: place.version,
        },
      },
      layers: [
        {
          name: { type: 'user', file: place.config, profile: null },
          version: place.version,
          config: {},
        },
      ],
    },
  };
}

function runner(place: World): ProcessRunner {
  return {
    async run(request) {
      if (request.executable !== 'codex') return missing(request);
      if (request.args[0] === '--version') return success(request, 'codex-cli 0.146.0');
      if (request.args[0] !== 'app-server') return missing(request);

      const stdin = request.stdin ?? '';
      const messages = stdin
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      if (stdin.includes('account/rateLimits/read')) {
        return success(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify({
              id: 2,
              result: {
                rateLimits: null,
                rateLimitsByLimitId: null,
                rateLimitResetCredits: null,
              },
            }),
          ].join('\n'),
        );
      }

      if (stdin.includes('config/batchWrite')) {
        const batch = messages.find((message) => message['method'] === 'config/batchWrite');
        assert.ok(batch);
        const batchId = batch['id'];
        assert.ok(typeof batchId === 'string' || typeof batchId === 'number');
        const verification = messages.find((message) => message['method'] === 'config/read');
        assert.ok(verification);
        const verificationId = verification['id'];
        assert.ok(typeof verificationId === 'string' || typeof verificationId === 'number');
        assert.deepEqual(request.stdinCloseAfterStdoutLineIncludesAll, [
          'token-harness-config-batch-write',
          'token-harness-config-verify',
        ]);
        const params = batch['params'];
        assert.ok(typeof params === 'object' && params !== null && !Array.isArray(params));
        const record = params as Record<string, unknown>;
        assert.equal(record['filePath'], place.config);

        if (record['expectedVersion'] !== place.version) {
          return success(
            request,
            JSON.stringify({
              id: batchId,
              error: {
                code: -32600,
                message: 'configVersionConflict: Configuration was modified since last read',
              },
            }),
          );
        }

        const edits = record['edits'];
        assert.ok(Array.isArray(edits));
        for (const edit of edits) {
          assert.ok(typeof edit === 'object' && edit !== null && !Array.isArray(edit));
          const entry = edit as Record<string, unknown>;
          if (entry['keyPath'] === 'model_reasoning_effort') {
            place.effort = String(entry['value']);
          }
          if (entry['keyPath'] === 'model_verbosity') {
            place.verbosity = String(entry['value']);
          }
        }
        place.version = 'user-v2';
        writeFileSync(
          place.config,
          'model_reasoning_effort = "' +
            place.effort +
            '"\nmodel_verbosity = "' +
            place.verbosity +
            '"\n# user comment\n',
        );

        return success(
          request,
          [
            JSON.stringify({ id: batchId, result: { version: place.version } }),
            JSON.stringify(configReadResult(place, verificationId)),
          ].join('\n'),
        );
      }

      if (stdin.includes('config/read')) {
        return success(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify(configReadResult(place, 2)),
            JSON.stringify({ id: 3, result: { data: [], nextCursor: null } }),
            JSON.stringify({
              id: 4,
              result: {
                data: [
                  {
                    id: 'gpt-5.6-codex',
                    model: 'gpt-5.6-codex',
                    displayName: 'GPT-5.6 Codex',
                    modelSpecialty: null,
                    supportedReasoningEfforts: [
                      { reasoningEffort: 'low', description: 'Low' },
                      { reasoningEffort: 'medium', description: 'Medium' },
                      { reasoningEffort: 'high', description: 'High' },
                    ],
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

      return success(request, '');
    },
  };
}

interface Captured<T> {
  exitCode: number;
  data: T | null;
  envelope: CliEnvelope<T>;
}

async function invoke<T>(argv: readonly string[], place: World): Promise<Captured<T>> {
  const fs = new NodeFileSystem(FACTS);
  let stdout = '';
  const options: RunOptions = {
    argv: [...argv, '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: () => undefined,
    },
    platform: FACTS,
    cwd: place.project,
    home: place.home,
    stateRoot: place.state,
    adapters: {
      fs,
      runner: runner(place),
      paths: {
        home: place.home,
        config: join(place.home, 'config'),
        data: join(place.home, 'data'),
        state: place.state,
        cache: join(place.home, 'cache'),
      },
      localDatabase: null,
      projectIdFor: (path) => deriveProjectId(path, SALT, FACTS.os === 'windows'),
    },
    compatibilityRows: null,
    metrics: null,
    now: () => NOW,
  };

  const exitCode = await run(options);
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { exitCode, data: envelope.data, envelope };
}

async function nativePlan(place: World): Promise<Captured<PlanReport>> {
  return invoke<PlanReport>(
    [
      'plan',
      '--native-policy',
      '--harness',
      'codex',
      '--provider',
      'none',
      '--task',
      'mechanical',
      '--profile',
      'economy',
    ],
    place,
  );
}

describe('persisted Codex native policy', () => {
  it('persists the exact reviewed atomic batch and applies that stored plan', async () => {
    const place = world();
    const planned = await nativePlan(place);

    assert.equal(planned.exitCode, 0);
    assert.equal(planned.data?.persisted, true);
    const planId = planned.data?.planId;
    assert.ok(planId);

    const action = planned.data?.actions.find(
      (candidate) => candidate.kind === 'codex-config-batch-write',
    );
    assert.ok(action);
    assert.equal(action.expectedVersion, 'user-v1');
    assert.equal(action.policyGuard, 'subscription-safe');
    assert.deepEqual(action.edits, [
      { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'replace' },
      { keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'replace' },
    ]);

    const applied = await invoke<ApplyReport>(
      ['apply', '--yes', '--plan', planId, '--harness', 'codex', '--provider', 'none'],
      place,
    );

    assert.equal(applied.exitCode, 0);
    assert.equal(applied.data?.outcome, 'committed');
    assert.equal(applied.data?.fromStoredPlan, true);
    assert.equal(place.effort, 'low');
    assert.equal(place.verbosity, 'low');
    assert.match(readFileSync(place.config, 'utf8'), /model_reasoning_effort = "low"/);
    assert.match(readFileSync(place.config, 'utf8'), /model_verbosity = "low"/);
  });

  it('rejects the stored action as drift when Codex config version changes before apply', async () => {
    const place = world();
    const planned = await nativePlan(place);
    const planId = planned.data?.planId;
    assert.ok(planId);
    const original = readFileSync(place.config, 'utf8');

    place.version = 'external-v2';

    const applied = await invoke<ApplyReport>(
      ['apply', '--yes', '--plan', planId, '--harness', 'codex', '--provider', 'none'],
      place,
    );

    assert.equal(applied.exitCode, 5);
    assert.equal(readFileSync(place.config, 'utf8'), original);
    assert.ok(
      applied.envelope.diagnostics.some((entry) => entry.code === 'action-precondition-drift'),
    );
  });
});

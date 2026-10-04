import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { it } from 'node:test';

import {
  deriveProjectId,
  type ApplyReport,
  type CliEnvelope,
  type PlanReport,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { run } from 'token-harness';

const facts: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable,
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

for (const [harness, version] of [
  ['codex', '0.146.0'],
  ['codex', '0.159.1'],
  ['claude', '2.1.285'],
] as const) {
  it(`applies a stored ${harness} ${version} routing plan without repeating selectors and rolls it back`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'th-routing-apply-'));
    const home = join(root, 'home');
    const state = join(root, 'state');
    const project = join(root, 'project');
    const settingsDir = join(home, harness === 'codex' ? '.codex' : '.claude');
    const settings = join(settingsDir, harness === 'codex' ? 'hooks.json' : 'settings.json');
    for (const path of [state, project, settingsDir]) mkdirSync(path, { recursive: true });
    const original = JSON.stringify({
      theme: 'dark',
      hooks: {
        PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'user-linter' }] }],
      },
    });
    writeFileSync(settings, original);
    const fs = new NodeFileSystem(facts);
    const runner = {
      run: async (request: ProcessRequest) =>
        outcome(
          request,
          request.executable === 'token-harness'
            ? 'token-harness-prompt-router-v1'
            : request.args[0] === '--version'
              ? harness === 'codex'
                ? `codex-cli ${version}`
                : `${version} (Claude Code)`
              : '',
        ),
    };
    let tick = 0;
    async function invoke<T>(argv: string[]): Promise<CliEnvelope<T>> {
      let stdout = '';
      const exitCode = await run({
        argv: [...argv, '--json'],
        streams: {
          out: (text) => {
            stdout += text;
          },
          err: () => undefined,
        },
        platform: facts,
        cwd: project,
        home,
        stateRoot: state,
        adapters: {
          fs,
          runner,
          paths: {
            home,
            config: join(home, 'config'),
            data: join(home, 'data'),
            state,
            cache: join(home, 'cache'),
          },
          localDatabase: null,
          projectIdFor: (path) => deriveProjectId(path, 'a'.repeat(64), facts.os === 'windows'),
        },
        compatibilityRows: null,
        metrics: null,
        now: () => new Date(Date.UTC(2026, 9, 3, 12, 0, tick++)).toISOString(),
      });
      const envelope = JSON.parse(stdout) as CliEnvelope<T>;
      assert.equal(exitCode, 0, JSON.stringify(envelope.diagnostics));
      return envelope;
    }
    try {
      const plan = await invoke<PlanReport>([
        'plan',
        '--provider',
        'none',
        '--harness',
        harness,
        '--agent-routing',
      ]);
      assert.ok(plan.data?.persisted);
      assert.equal(readFileSync(settings, 'utf8'), original);
      const applied = await invoke<ApplyReport>(['apply', '--plan', plan.data!.planId!, '--yes']);
      assert.equal(applied.data?.outcome, 'committed');
      const document = JSON.parse(readFileSync(settings, 'utf8'));
      assert.deepEqual(document.hooks.PreToolUse, JSON.parse(original).hooks.PreToolUse);
      for (const event of ['UserPromptSubmit', 'SubagentStart', 'SubagentStop'])
        assert.equal(document.hooks[event].length, 1);
      assert.equal(document.theme, 'dark');
      await invoke(['rollback', '--yes']);
      assert.equal(readFileSync(settings, 'utf8'), original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

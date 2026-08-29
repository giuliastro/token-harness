/**
 * PLAN item 33 + RFC 0009: managed HarnessTrim on Hermes/Pi stays behind real evidence.
 *
 * The runner is fully synthetic: no upstream executable and no real home is touched. These tests
 * prove the product gate, not a real-machine compatibility row. Shipping rows remain blocked on
 * the second-machine replay with HarnessTrim 0.1.0.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  EXIT_CODES,
  harnessId,
  providerId,
  type CliEnvelope,
  type CompatibilityRow,
  type PlanReport,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { run } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const NOW = '2026-08-29T06:00:00.000Z';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-managed-harnesstrim-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: `/fake/${request.executable}`,
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

function missing(request: ProcessRequest): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
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
    failure: { reason: 'executable-not-found', message: 'synthetic test executable is absent' },
  };
}

function capabilities(harness: 'hermes' | 'pi'): string {
  const harnesses =
    harness === 'hermes'
      ? {
          hermes: {
            adapter: '@harnesstrim/adapter-hermes',
            surfaces: ['transform_tool_result — deterministic reduction before context'],
            narrowing: [
              { flag: '--mode active|dryrun|off', produces: 'bake mode into config.json' },
              { flag: '--min-length <n>', produces: 'bake minimum length into config.json' },
              { flag: '--no-enable', produces: 'copy bundle without editing config.yaml' },
            ],
            writeSet: [
              '.hermes/plugins/harnesstrim/ (incl. .installed marker + config.json)',
              '.hermes/config.yaml (plugins.enabled entry; skipped with --no-enable)',
            ],
          },
        }
      : {
          pi: {
            adapter: '@harnesstrim/adapter-pi',
            surfaces: ['tool_result — deterministic reduction of structured results'],
            narrowing: [
              { flag: '--mode active|dryrun|off', produces: 'bake mode into config.json' },
              { flag: '--min-length <n>', produces: 'bake minimum length into config.json' },
              { flag: '--metrics <path>', produces: 'write TrimEvent JSONL' },
            ],
            writeSet: [
              '.pi/extensions/harnesstrim/ or .pi/agent/extensions/harnesstrim/ ' +
                '(incl. .installed marker + config.json)',
            ],
          },
        };
  return JSON.stringify({ version: '0.1.0', harnesses });
}

class ManagedRunner implements ProcessRunner {
  private readonly harness: 'hermes' | 'pi';

  constructor(harness: 'hermes' | 'pi') {
    this.harness = harness;
  }

  run(request: ProcessRequest): Promise<ProcessOutcome> {
    if (request.executable === 'harnesstrim' && request.args[0] === '--version') {
      return Promise.resolve(outcome(request, '0.1.0\n'));
    }
    if (request.executable === 'harnesstrim' && request.args[0] === 'capabilities') {
      return Promise.resolve(outcome(request, capabilities(this.harness)));
    }
    if (this.harness === 'hermes' && request.executable === 'hermes') {
      if (request.args[0] === '--version') {
        return Promise.resolve(outcome(request, 'Hermes Agent v0.19.0 (2026.7.20)\n'));
      }
      if (request.args[0] === 'plugins' && request.args[1] === 'list') {
        return Promise.resolve(outcome(request, 'security-guidance enabled\n'));
      }
    }
    if (
      this.harness === 'pi' &&
      request.executable === 'pi' &&
      request.args[0] === '--version'
    ) {
      return Promise.resolve(outcome(request, '0.83.0\n'));
    }
    return Promise.resolve(missing(request));
  }
}

function row(harness: 'hermes' | 'pi'): CompatibilityRow {
  return {
    harness: harnessId(harness),
    harnessVersion:
      harness === 'hermes'
        ? { minimum: '0.19.0', maximum: '0.19.0' }
        : { minimum: '0.83.0', maximum: '0.83.0' },
    provider: providerId('harnesstrim'),
    providerVersion: '0.1.0',
    platform: { os: FACTS.os, wsl: false, supported: true, limitation: null },
    configSchema: harness === 'hermes' ? 'hermes-plugins-enabled-yaml' : 'pi-extension-directory',
    fixture: `synthetic-only/${harness}`,
    verificationTier: 'config-only',
  };
}

async function invoke(
  harness: 'hermes' | 'pi',
  rows: readonly CompatibilityRow[],
): Promise<{ exitCode: number; envelope: CliEnvelope<PlanReport> }> {
  counter += 1;
  const root = join(sandbox, `${harness}-${String(counter)}`);
  const home = join(root, 'home');
  const project = join(root, 'project');
  const state = join(root, 'state');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });

  if (harness === 'hermes') {
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(
      join(home, '.hermes', 'config.yaml'),
      'plugins:\n  disabled: []\n  enabled:\n    - google_meet\n    - rtk-rewrite\n',
    );
  }

  const fs = new NodeFileSystem(FACTS);
  let stdout = '';
  const exitCode = await run({
    argv: ['plan', '--harness', harness, '--provider', 'harnesstrim', '--json'],
    streams: { out: (text) => (stdout += text), err: () => undefined },
    platform: FACTS,
    cwd: project,
    home,
    stateRoot: state,
    adapters: {
      fs,
      runner: new ManagedRunner(harness),
      paths: {
        home,
        config: join(home, 'config'),
        data: join(home, 'data'),
        state,
        cache: join(home, 'cache'),
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
    compatibilityRows: rows,
    metrics: null,
    now: () => NOW,
  });

  return { exitCode, envelope: JSON.parse(stdout) as CliEnvelope<PlanReport> };
}

describe('HarnessTrim managed gate for item 33', () => {
  for (const harness of ['hermes', 'pi'] as const) {
    it(`keeps ${harness} mutation blocked without an RFC 0009 row`, async () => {
      const result = await invoke(harness, []);
      assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
      assert.equal(result.envelope.data, null);
      assert.equal(
        result.envelope.diagnostics?.some((entry) => entry.code === 'managed-mutation-blocked'),
        true,
      );
    });

    it(
      `admits the exact synthetic ${harness} combination only when a row is injected`,
      async () => {
        const result = await invoke(harness, [row(harness)]);
        assert.equal(result.exitCode, EXIT_CODES.ok);
        assert.ok(result.envelope.data);

        if (harness === 'hermes') {
          assert.deepEqual(
            result.envelope.data.actions.map((action) => action.kind),
            ['delegated-provider-install', 'merge-yaml'],
          );
        } else {
          assert.deepEqual(
            result.envelope.data.actions.map((action) => action.kind),
            ['delegated-provider-install'],
          );
        }
      },
    );
  }
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import {
  scopeProviderVerificationToHarness,
  type PassiveReceipt,
  type ProviderContext,
  type ProviderVerification,
} from '../src/index.js';

const HOME = 'C:\\Users\\dev';
const PROJECT = 'C:\\work\\demo';
const METRICS = `${PROJECT}\\.harnesstrim\\metrics.jsonl`;
const CODEX = harnessId('codex');
const OPENCODE = harnessId('opencode');
const CLAUDE = harnessId('claude');
const HARNESSTRIM = providerId('harnesstrim');
const RTK = providerId('rtk');

const FACTS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11 Pro',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

function context(files: Record<string, string> = {}): ProviderContext {
  const encoder = new TextEncoder();
  return {
    fs: {
      join: (...parts) => parts.join('\\'),
      dirname: (path) => path.slice(0, path.lastIndexOf('\\')),
      basename: (path) => path.slice(path.lastIndexOf('\\') + 1),
      isInside: (candidate, parent) => candidate.startsWith(parent),
      stat: (path): Promise<FileStat | null> =>
        Promise.resolve(
          Object.hasOwn(files, path)
            ? { kind: 'file', byteLength: (files[path] ?? '').length, mode: null }
            : null,
        ),
      readFile: (path) => Promise.resolve(encoder.encode(files[path] ?? '')),
      writeFile: () => Promise.reject(new Error('read-only test port')),
      appendFile: () => Promise.reject(new Error('read-only test port')),
      createDirectory: () => Promise.reject(new Error('read-only test port')),
      remove: () => Promise.reject(new Error('read-only test port')),
      readDirectory: () => Promise.resolve([]),
    },
    runner: {
      run: (request: ProcessRequest): Promise<ProcessOutcome> =>
        Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
          executablePath: request.executable,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        }),
    },
    facts: FACTS,
    paths: {
      home: HOME,
      config: `${HOME}\\cfg`,
      data: `${HOME}\\data`,
      state: `${HOME}\\state`,
      cache: `${HOME}\\cache`,
    },
    projectRoot: PROJECT,
    harnessConfigs: [],
    now: () => '2026-09-12T12:00:00.000Z',
    localDatabase: null,
    projectIdFor: () => 'p_test',
  };
}

function receipt(): PassiveReceipt {
  return {
    observedAt: '2026-09-12T11:59:00.000Z',
    operations: 42,
    source: 'provider-wide',
  };
}

function verification(
  id: 'harnesstrim' | 'rtk',
  passiveReceipt: PassiveReceipt | null,
): ProviderVerification {
  return {
    providerId: id === 'harnesstrim' ? HARNESSTRIM : RTK,
    declaredTier: id === 'harnesstrim' ? 'config-only' : 'canary',
    achievedTier: passiveReceipt === null ? 'config-only' : 'canary',
    receipt: passiveReceipt,
    checks: [
      {
        id: 'executable-resolves',
        status: 'pass',
        summary: `${id} runs`,
        achievedTier: 'presence',
        evidence: [],
        remediation: null,
      },
      {
        id: 'hook-registered',
        status: 'pass',
        summary: 'wired to codex, opencode',
        achievedTier: 'config-only',
        evidence: [],
        remediation: null,
      },
      {
        id: 'canary-intercepted',
        status: passiveReceipt === null ? 'not-exercised' : 'pass',
        summary: passiveReceipt === null ? 'nothing observed' : '42 operations observed',
        achievedTier: passiveReceipt === null ? null : 'canary',
        evidence: [],
        remediation: null,
      },
    ],
    diagnostics: [],
  };
}

function trimEvent(harness: string, eventId: string, ts: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    eventId,
    ts,
    harness,
    tool: 'bash',
    reducer: 'test-output-slim',
    beforeChars: 1200,
    afterChars: 200,
    changed: true,
    beforeTokens: null,
    afterTokens: null,
  });
}

describe('harness-scoped passive verification', () => {
  it('attributes HarnessTrim receipts to the exact native harness', async () => {
    const metrics = [
      trimEvent('codex', 'codex-1', '2026-09-12T10:00:00.000Z'),
      trimEvent('opencode', 'opencode-1', '2026-09-12T10:30:00.000Z'),
      trimEvent('codex', 'codex-2', '2026-09-12T11:00:00.000Z'),
    ].join('\n');
    const provider = verification('harnesstrim', receipt());

    const codex = await scopeProviderVerificationToHarness(
      context({ [METRICS]: `${metrics}\n` }),
      provider,
      CODEX,
      [CODEX, OPENCODE],
    );
    const opencode = await scopeProviderVerificationToHarness(
      context({ [METRICS]: `${metrics}\n` }),
      provider,
      OPENCODE,
      [CODEX, OPENCODE],
    );

    assert.equal(codex.receipt?.operations, 2);
    assert.equal(codex.receipt?.observedAt, '2026-09-12T11:00:00.000Z');
    assert.match(
      codex.checks.find((check) => check.id === 'canary-intercepted')?.summary ?? '',
      /2 reductions recorded for codex/,
    );
    assert.equal(opencode.receipt?.operations, 1);
    assert.match(
      opencode.checks.find((check) => check.id === 'canary-intercepted')?.summary ?? '',
      /1 reductions recorded for opencode/,
    );
  });

  it('does not let a Codex HarnessTrim receipt satisfy OpenCode', async () => {
    const metrics = `${trimEvent('codex', 'codex-only', '2026-09-12T11:00:00.000Z')}\n`;
    const scoped = await scopeProviderVerificationToHarness(
      context({ [METRICS]: metrics }),
      verification('harnesstrim', receipt()),
      OPENCODE,
      [CODEX, OPENCODE],
    );

    assert.equal(scoped.receipt, null);
    const canary = scoped.checks.find((check) => check.id === 'canary-intercepted');
    assert.equal(canary?.status, 'not-exercised');
    assert.equal(canary?.achievedTier, null);
    assert.match(canary?.summary ?? '', /no telemetry receipt attributed to opencode yet/);
    assert.equal(scoped.achievedTier, 'config-only');
  });

  it(
    'does not duplicate provider-wide RTK runtime evidence across multiple harnesses',
    async () => {
      const provider = verification('rtk', receipt());
      for (const harness of [CLAUDE, OPENCODE]) {
        const scoped = await scopeProviderVerificationToHarness(
          context(),
          provider,
          harness,
          [CLAUDE, OPENCODE],
        );
        assert.equal(scoped.receipt, null);
        assert.equal(scoped.achievedTier, 'config-only');
        const canary = scoped.checks.find((check) => check.id === 'canary-intercepted');
        assert.equal(canary?.status, 'info');
        assert.equal(canary?.achievedTier, null);
        assert.match(canary?.summary ?? '', /cannot attribute that receipt/);
      }
    },
  );

  it(
    'can attribute provider-wide evidence by exclusion when exactly one harness is wired',
    async () => {
      const provider = verification('rtk', receipt());
      const scoped = await scopeProviderVerificationToHarness(
        context(),
        provider,
        CLAUDE,
        [CLAUDE],
      );

      assert.deepEqual(scoped.receipt, provider.receipt);
      assert.equal(scoped.achievedTier, 'canary');
      assert.equal(
        scoped.checks.find((check) => check.id === 'canary-intercepted')?.status,
        'pass',
      );
    },
  );
});

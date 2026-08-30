import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileStat,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import { codexAdapter, type HarnessContext } from '../src/index.js';

const HOME = '/home/dev';
const PROJECT = `${HOME}/project`;
const HOOKS = `${HOME}/.codex/hooks.json`;
const CONFIG = `${HOME}/.codex/config.toml`;
const FACTS: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function context(
  files: Record<string, string> = {},
  version: string | null = '0.146.0',
): HarnessContext {
  const encoder = new TextEncoder();
  return {
    fs: {
      join: (...parts) => parts.join('/').replaceAll('//', '/'),
      dirname: (path) => path.split('/').slice(0, -1).join('/'),
      basename: (path) => path.split('/').at(-1) ?? path,
      isInside: (candidate, parent) => candidate.startsWith(parent),
      stat: async (path): Promise<FileStat | null> =>
        Object.hasOwn(files, path)
          ? { kind: 'file', byteLength: files[path]?.length ?? 0, mode: null }
          : null,
      readFile: async (path) => encoder.encode(files[path] ?? ''),
      writeFile: async () => {
        throw new Error('read-only test port');
      },
      appendFile: async () => {
        throw new Error('read-only test port');
      },
      createDirectory: async () => {
        throw new Error('read-only test port');
      },
      remove: async () => {
        throw new Error('read-only test port');
      },
      readDirectory: async () => [],
    },
    runner: {
      run: async (request: ProcessRequest): Promise<ProcessOutcome> => ({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: version === null ? null : '/usr/local/bin/codex',
        exitCode: version === null ? null : 0,
        signal: null,
        stdout: version ?? '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: version === null ? { reason: 'executable-not-found', message: 'missing' } : null,
      }),
    } satisfies ProcessRunner,
    facts: FACTS,
    paths: {
      home: HOME,
      config: `${HOME}/.config/token-harness`,
      data: `${HOME}/.local/share/token-harness`,
      state: `${HOME}/.local/state/token-harness`,
      cache: `${HOME}/.cache/token-harness`,
    },
    projectRoot: PROJECT,
  };
}

const DECLARED = JSON.stringify({
  hooks: {
    PostToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'rtk hook codex' }] }],
  },
});

describe('Codex adapter', () => {
  it('detects a declared hook only with executable corroboration', async () => {
    assert.equal(
      (await codexAdapter.detect(context({ [HOOKS]: DECLARED, [CONFIG]: '[projects]\n' }))).state,
      'configured',
    );
    assert.equal(
      (await codexAdapter.detect(context({ [HOOKS]: DECLARED }, null))).state,
      'detected',
    );
  });

  it('reads the separate hooks file and exposes its command without interpreting ownership', async () => {
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: DECLARED }));
    assert.deepEqual(inspection.summaries[0]?.commands, ['rtk hook codex']);
    assert.equal(inspection.enabled, null);
  });

  it('does not convert a declared hook into an enabled hook', async () => {
    const result = await codexAdapter.verify(context({ [HOOKS]: DECLARED }));
    assert.equal(result.declaredTier, 'config-only');
    assert.equal(result.achievedTier, 'config-only');
    assert.equal(result.checks.find((check) => check.id === 'hook-enablement')?.status, 'info');
    assert.equal(
      result.checks.find((check) => check.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
  });

  it('reports unreadable hooks as broken rather than guessing', async () => {
    const result = await codexAdapter.detect(context({ [HOOKS]: '{ hooks: }' }));
    assert.equal(result.state, 'broken');
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ['harness-config-unreadable'],
    );
  });
});

describe('both interception points', () => {
  /**
   * The gap these close.
   *
   * The adapter read `hooks.PostToolUse` and declared that point alone, because that is what the
   * spike machine happened to have configured. The same spike found `PreToolUse` in `codex.exe`
   * 0.146.0, so a user with a hook there had it silently ignored — invisible to `inspect`, and
   * therefore invisible to the conflict detection that names a competing entry on an owned surface.
   */
  const PRE = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: '^Bash$', hooks: [{ type: 'command', command: 'somebody-elses-tool' }] },
      ],
    },
  });

  it('declares both points in the manifest', () => {
    assert.deepEqual(
      codexAdapter.manifest.interceptionPoints.map((point) => point.scopeId),
      ['pre-tool-use', 'post-tool-use'],
    );
  });

  it('sees a hook declared only at PreToolUse', async () => {
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: PRE }));
    assert.deepEqual(inspection.summaries[0]?.interceptionPoints, ['pre-tool-use']);
    // The command has to reach the summary, because that is the seam a provider recognises itself
    // in and the conflict detector reads.
    assert.deepEqual(inspection.summaries[0]?.commands, ['somebody-elses-tool']);
  });

  it('reports both points when both carry entries', async () => {
    const both = JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] }],
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'b' }] }],
      },
    });
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: both }));
    assert.deepEqual(inspection.summaries[0]?.interceptionPoints, [
      'pre-tool-use',
      'post-tool-use',
    ]);
    assert.deepEqual(inspection.summaries[0]?.commands.sort(), ['a', 'b']);
  });

  it('names the point it found rather than a hardcoded one', async () => {
    const result = await codexAdapter.verify(context({ [HOOKS]: PRE }));
    const registered = result.checks.find((check) => check.id === 'hook-registered');
    // The summary said "PostToolUse entry is declared" whatever it found, which is a report about
    // the wrong surface.
    assert.match(registered?.summary ?? '', /pre-tool-use/);
  });

  it('treats a point declared with no command as carrying nothing', async () => {
    // An empty array is a declaration of intent, not a configured hook, and reporting it as
    // configured would make `doctor` claim an integration that cannot run.
    const empty = JSON.stringify({ hooks: { PostToolUse: [] } });
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: empty }));
    assert.deepEqual(inspection.summaries, []);
    assert.equal((await codexAdapter.detect(context({ [HOOKS]: empty }))).state, 'detected');
  });
});

describe('tool-family coverage', () => {
  it('accepts the regex matcher Codex actually uses', async () => {
    // `^Bash$`, not `Bash`. A literal comparison would call the covered family uncovered and
    // report a bypass that does not exist.
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: DECLARED }));
    assert.deepEqual(inspection.uncoveredToolFamilies, []);
  });

  it('reports a family a matcher does not cover', async () => {
    // Computed rather than asserted: this field was hardcoded to `[]`, which claims full coverage
    // without checking. Computing it is how the spike found PowerShell bypassed on Claude Code.
    const narrow = JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: '^Read$', hooks: [{ type: 'command', command: 'x' }] }],
      },
    });
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: narrow }));
    assert.deepEqual(inspection.uncoveredToolFamilies, ['Bash']);
  });

  it('reports no gap when nothing is configured at all', async () => {
    // Not "everything is bypassed": with no matcher there is no integration to have a gap in, and
    // `doctor` already reports the harness as merely detected.
    const inspection = await codexAdapter.inspect(context({}));
    assert.deepEqual(inspection.uncoveredToolFamilies, []);
  });
});


describe('subscription usage', () => {
  it('reads five-hour and weekly Codex windows through app-server without a credit mutation', async () => {
    const base = context();
    const requests: ProcessRequest[] = [];
    const rateLimit = {
      limitId: 'codex',
      limitName: 'Codex',
      primary: {
        usedPercent: 42.5,
        windowDurationMins: 300,
        resetsAt: 1788105600,
      },
      secondary: {
        usedPercent: 12,
        windowDurationMins: 10080,
        resetsAt: 1788710400,
      },
      credits: null,
      individualLimit: null,
      spendControlReached: null,
      planType: 'pro',
      rateLimitReachedType: null,
    };
    const observedContext: HarnessContext = {
      ...base,
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
          requests.push(request);
          return {
            displayCommand: 'codex app-server --stdio',
            interpreter: 'direct',
            executablePath: '/usr/local/bin/codex',
            exitCode: 0,
            signal: null,
            stdout: [
              JSON.stringify({ id: 1, result: { userAgent: 'codex-test' } }),
              JSON.stringify({
                id: 2,
                result: {
                  rateLimits: rateLimit,
                  rateLimitsByLimitId: { codex: rateLimit },
                  rateLimitResetCredits: { availableCount: 2, credits: [] },
                },
              }),
              '',
            ].join('\n'),
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            durationMs: 2,
            timedOut: false,
            failure: null,
          };
        },
      },
    };

    const result = await codexAdapter.observeUsage?.(observedContext, '2026-08-30T14:00:00.000Z');
    assert.ok(result);
    assert.equal(result.state, 'observed');
    assert.equal(result.planType, 'pro');
    assert.equal(result.resetCreditsAvailable, 2);
    assert.deepEqual(
      result.windows.map((window) => ({
        scope: window.scope,
        used: window.usedPercent,
        remaining: window.remainingPercent,
        resetsAt: window.resetsAt,
      })),
      [
        {
          scope: 'five-hour',
          used: 42.5,
          remaining: 57.5,
          resetsAt: '2026-08-30T16:00:00.000Z',
        },
        {
          scope: 'weekly',
          used: 12,
          remaining: 88,
          resetsAt: '2026-09-06T16:00:00.000Z',
        },
      ],
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.args, ['app-server', '--stdio']);
    assert.match(requests[0]?.stdin ?? '', /account\/rateLimits\/read/);
    assert.doesNotMatch(requests[0]?.stdin ?? '', /consume|redeem/i);
  });

  it('keeps an unrecognized backend duration as an unknown window', async () => {
    const base = context();
    const observedContext: HarnessContext = {
      ...base,
      runner: {
        run: async (): Promise<ProcessOutcome> => ({
          displayCommand: 'codex app-server --stdio',
          interpreter: 'direct',
          executablePath: '/usr/local/bin/codex',
          exitCode: 0,
          signal: null,
          stdout: [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify({
              id: 2,
              result: {
                rateLimits: {
                  limitId: 'future-bucket',
                  limitName: null,
                  primary: {
                    usedPercent: 1,
                    windowDurationMins: 123,
                    resetsAt: null,
                  },
                  secondary: null,
                  credits: null,
                  individualLimit: null,
                  spendControlReached: null,
                  planType: null,
                  rateLimitReachedType: null,
                },
                rateLimitsByLimitId: null,
                rateLimitResetCredits: null,
              },
            }),
          ].join('\n'),
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        }),
      },
    };

    const result = await codexAdapter.observeUsage?.(observedContext, '2026-08-30T14:00:00.000Z');
    assert.ok(result);
    assert.equal(result.windows[0]?.scope, 'unknown');
    assert.equal(result.windows[0]?.windowDurationMinutes, 123);
  });
});

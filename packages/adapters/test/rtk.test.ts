/**
 * The RTK adapter — PLAN §10 acceptance.
 *
 * "Fixtures for absent, installed, configured, old, unknown-new, and broken states" and
 * "the brownfield fixtures, including RTK already configured in the surface Token Harness
 * would claim". No installed RTK is required: the analytics come from a fake runner
 * returning the document shape observed on a real machine.
 *
 * The load-bearing test is the passive canary. The Phase 2.5 spike demonstrated tier 3 by
 * hand; these assert that the adapter reaches it from the provider's own record, and — just
 * as importantly — that it refuses to when the record is empty.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileSystemPort,
  HarnessConfigSummary,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import {
  harnessesWiredToRtk,
  parseRtkAnalytics,
  rtkAdapter,
  type ProviderContext,
} from '../src/index.js';

const FACTS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

/** The document `rtk gain --all --format json` returned on the spike machine. */
function analyticsDocument(days: ReadonlyArray<{ date: string; commands: number }>): string {
  return JSON.stringify({
    summary: {
      total_commands: days.reduce((sum, day) => sum + day.commands, 0),
      total_input: 965005,
      total_output: 875338,
      total_saved: 91426,
      avg_savings_pct: 9.474147802342992,
      total_time_ms: 9527241,
      avg_time_ms: 3384,
    },
    daily: days.map((day) => ({
      date: day.date,
      commands: day.commands,
      input_tokens: 470773,
      output_tokens: 451060,
      saved_tokens: 20130,
      savings_pct: 4.2759461566402495,
      total_time_ms: 391238,
      avg_time_ms: 782,
    })),
  });
}

const NO_FILESYSTEM: FileSystemPort = {
  join: (...segments) => segments.join('/'),
  dirname: (path) => path,
  basename: (path) => path,
  isInside: () => false,
  // RTK detection reads no files: everything comes from the runner and from what the
  // harness adapters already reported. A port that throws proves it.
  stat: () => Promise.reject(new Error('the rtk adapter must not read the filesystem')),
  readFile: () => Promise.reject(new Error('the rtk adapter must not read the filesystem')),
  writeFile: () => Promise.reject(new Error('the rtk adapter must not write')),
  appendFile: () => Promise.reject(new Error('the rtk adapter must not write')),
  createDirectory: () => Promise.reject(new Error('the rtk adapter must not write')),
  remove: () => Promise.reject(new Error('the rtk adapter must not write')),
  readDirectory: () => Promise.resolve([]),
};

interface RunnerOptions {
  version?: string | null;
  analytics?: string | null;
}

function runner(options: RunnerOptions): ProcessRunner {
  return {
    run: (request: ProcessRequest): Promise<ProcessOutcome> => {
      const isVersion = request.args[0] === '--version';
      const payload = isVersion
        ? options.version === undefined
          ? 'rtk 0.42.0'
          : options.version
        : options.analytics === undefined
          ? analyticsDocument([{ date: '2026-07-30', commands: 500 }])
          : options.analytics;
      return Promise.resolve({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: payload === null ? null : 'C:\\tools\\rtk.exe',
        exitCode: payload === null ? null : 0,
        signal: null,
        stdout: payload ?? '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure:
          payload === null ? { reason: 'executable-not-found', message: 'no rtk on PATH' } : null,
      });
    },
  };
}

const WIRED: HarnessConfigSummary = {
  harnessId: 'claude' as HarnessConfigSummary['harnessId'],
  configPath: 'C:\\Users\\dev\\.claude\\settings.json',
  scope: 'user',
  interceptionPoints: ['pre-tool-use'],
  matchers: ['Bash'],
  commands: ['rtk hook claude'],
};

const SOMEONE_ELSE: HarnessConfigSummary = {
  ...WIRED,
  matchers: ['Bash'],
  commands: ['"C:\\Users\\dev\\AppData\\Local\\pnpm\\harnesstrim.CMD" hook claude'],
};

function context(
  options: RunnerOptions & { configs?: HarnessConfigSummary[]; now?: string },
): ProviderContext {
  return {
    fs: NO_FILESYSTEM,
    runner: runner(options),
    facts: FACTS,
    paths: {
      home: 'C:\\Users\\dev',
      config: 'C:\\Users\\dev\\AppData\\Roaming\\TokenHarness',
      data: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
      state: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
      cache: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness\\Cache',
    },
    projectRoot: 'C:\\work\\demo',
    harnessConfigs: options.configs ?? [],
    now: () => options.now ?? '2026-07-30T12:00:00.000Z',
  };
}

describe('the analytics document', () => {
  it('reads the shape a real rtk returned', () => {
    const analytics = parseRtkAnalytics(
      analyticsDocument([
        { date: '2026-07-29', commands: 300 },
        { date: '2026-07-30', commands: 500 },
      ]),
    );
    assert.equal(analytics?.totalCommands, 800);
    assert.deepEqual(analytics?.latestDay, { date: '2026-07-30', commands: 500 });
  });

  it('picks the latest day regardless of array order', () => {
    const analytics = parseRtkAnalytics(
      analyticsDocument([
        { date: '2026-07-30', commands: 500 },
        { date: '2026-07-29', commands: 300 },
      ]),
    );
    assert.equal(analytics?.latestDay?.date, '2026-07-30');
  });

  it('ignores a day with no commands, because it is not a receipt', () => {
    const analytics = parseRtkAnalytics(
      analyticsDocument([
        { date: '2026-07-29', commands: 300 },
        { date: '2026-07-30', commands: 0 },
      ]),
    );
    assert.equal(analytics?.latestDay?.date, '2026-07-29');
  });

  it('returns no latest day when nothing has been intercepted', () => {
    const analytics = parseRtkAnalytics(analyticsDocument([]));
    assert.equal(analytics?.totalCommands, 0);
    assert.equal(analytics?.latestDay, null);
  });

  const refused: ReadonlyArray<readonly [string, string]> = [
    ['not JSON at all', 'RTK Token Savings (Global Scope)'],
    ['a JSON array', '[]'],
    ['an object with no summary', '{ "daily": [] }'],
    ['a summary with no command count', '{ "summary": { "total_saved": 1 } }'],
  ];
  for (const [name, text] of refused) {
    it(`refuses ${name} rather than guessing at a partial read`, () => {
      // A savings figure derived from a guess is what RFC 0005 exists to prevent.
      assert.equal(parseRtkAnalytics(text), null);
    });
  }
});

describe('recognising itself in a harness configuration', () => {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ['rtk hook claude', true],
    ['C:\\tools\\rtk.exe hook claude', true],
    ['"C:\\Program Files\\rtk\\rtk.exe" hook claude', true],
    ['/usr/local/bin/rtk hook claude', true],
    ['"C:\\pnpm\\harnesstrim.CMD" hook claude', false],
    ['rtkx hook claude', false],
    ['some-rtk-wrapper hook', false],
  ];
  for (const [command, expected] of cases) {
    it(`${expected ? 'recognises' : 'does not claim'} ${command}`, () => {
      const wired = harnessesWiredToRtk([{ ...WIRED, commands: [command] }]);
      assert.equal(wired.length === 1, expected);
    });
  }
});

describe('detection', () => {
  it('reports absent when rtk cannot be run and nothing is wired to it', async () => {
    const detection = await rtkAdapter.detect(context({ version: null, analytics: null }));
    assert.equal(detection.state, 'absent');
    assert.equal(detection.version, null);
    assert.deepEqual(detection.configuredHarnesses, []);
    assert.deepEqual(detection.warnings, []);
  });

  it('reports installed when rtk runs but no harness names it', async () => {
    const detection = await rtkAdapter.detect(context({}));
    assert.equal(detection.state, 'installed');
    assert.equal(detection.version, '0.42.0');
    assert.equal(detection.versionVerdict, 'in-range');
    assert.equal(detection.executable, 'C:\\tools\\rtk.exe');
  });

  it('reports configured when a harness hook names it', async () => {
    const detection = await rtkAdapter.detect(context({ configs: [WIRED] }));
    assert.equal(detection.state, 'configured');
    assert.deepEqual(detection.configuredHarnesses, ['claude']);
    assert.ok(
      detection.evidence.some(
        (item) => item.kind === 'config-entry' && item.path === WIRED.configPath,
      ),
    );
    // RFC 0002 §Detection: corroborating evidence, not a configuration string alone.
    assert.ok(detection.evidence.some((item) => item.kind === 'version-output'));
  });

  it('does not claim a harness wired to a different provider', async () => {
    const detection = await rtkAdapter.detect(context({ configs: [SOMEONE_ELSE] }));
    assert.equal(detection.state, 'installed');
    assert.deepEqual(detection.configuredHarnesses, []);
  });

  /**
   * The state that matters most: a hook that invokes a missing executable. Every command
   * the harness routes through it will fail, so this is `broken` with an error, not
   * `absent`.
   */
  it('reports broken when a hook invokes an rtk that cannot be run', async () => {
    const detection = await rtkAdapter.detect(
      context({ version: null, analytics: null, configs: [WIRED] }),
    );
    assert.equal(detection.state, 'broken');
    assert.deepEqual(
      detection.warnings.map((entry) => entry.code),
      ['provider-configured-but-missing'],
    );
    assert.equal(detection.warnings[0]?.severity, 'error');
    assert.equal(detection.warnings[0]?.path, WIRED.configPath);
  });

  it('warns on a version newer than anything observed', async () => {
    const detection = await rtkAdapter.detect(context({ version: 'rtk 9.9.9' }));
    assert.equal(detection.versionVerdict, 'unknown-newer');
    assert.deepEqual(
      detection.warnings.map((entry) => entry.code),
      ['provider-version-unknown-newer'],
    );
    assert.equal(detection.warnings[0]?.severity, 'warning');
  });

  it('reports below-range for an older rtk', async () => {
    const detection = await rtkAdapter.detect(context({ version: 'rtk 0.9.0' }));
    assert.equal(detection.versionVerdict, 'below-range');
  });

  it('never claims to have installed what it found', async () => {
    // RFC 0004 §Brownfield adoption: nothing has been applied yet, so every installation
    // on the machine is the user's.
    const detection = await rtkAdapter.detect(context({ configs: [WIRED] }));
    assert.equal(detection.managedByTokenHarness, false);
    assert.equal(detection.installationChannel, null);
  });

  it('does not claim a managed surface it does not have', async () => {
    // RFC 0002 §Providers may exceed the managed surface. RTK's manifest covers Claude
    // Code only, so the "any *managed* harness" qualifier does not apply to it.
    const detection = await rtkAdapter.detect(context({}));
    assert.equal(detection.supportsUnmanagedHarnesses, false);
    assert.deepEqual(detection.unmanagedHarnessesConfigured, []);
  });
});

/** RFC 0007 §Active and passive canaries. This is what the spike proved by hand. */
describe('the passive canary', () => {
  it('reaches canary from the provider own dated record', async () => {
    const verification = await rtkAdapter.verify(context({ configs: [WIRED] }));
    assert.equal(verification.declaredTier, 'canary');
    assert.equal(verification.achievedTier, 'canary');
    assert.deepEqual(verification.receipt, {
      observedAt: '2026-07-30',
      operations: 500,
      source: 'rtk gain --all --format json',
    });

    const check = verification.checks.find((entry) => entry.id === 'canary-intercepted');
    assert.equal(check?.status, 'pass');
    assert.equal(check?.achievedTier, 'canary');
    assert.match(check?.summary ?? '', /500 commands intercepted on 2026-07-30/);
  });

  it('reports not-exercised, not pass, when nothing has been intercepted', async () => {
    const verification = await rtkAdapter.verify(
      context({ configs: [WIRED], analytics: analyticsDocument([]) }),
    );
    // Nothing is wrong and nothing has happened. Asserting a pass here would claim
    // interception on no evidence.
    assert.equal(
      verification.checks.find((entry) => entry.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
    assert.equal(verification.receipt, null);
    assert.equal(verification.achievedTier, 'config-only');
  });

  it('says out loud when the receipt is stale', async () => {
    const verification = await rtkAdapter.verify(
      context({
        configs: [WIRED],
        analytics: analyticsDocument([{ date: '2026-07-01', commands: 12 }]),
        now: '2026-07-30T12:00:00.000Z',
      }),
    );
    // RFC 0007: "working as of three weeks ago" and "working as of a minute ago" are
    // different claims. Still a pass — nothing is broken — with the age recorded.
    assert.equal(
      verification.checks.find((entry) => entry.id === 'canary-intercepted')?.status,
      'pass',
    );
    const freshness = verification.checks.find((entry) => entry.id === 'receipt-freshness');
    assert.equal(freshness?.status, 'info');
    assert.match(freshness?.summary ?? '', /29 days ago/);
  });

  it('stays quiet about freshness for a receipt from today', async () => {
    const verification = await rtkAdapter.verify(context({ configs: [WIRED] }));
    assert.equal(
      verification.checks.some((entry) => entry.id === 'receipt-freshness'),
      false,
    );
  });

  it('fails the analytics check rather than the canary when the document is unreadable', async () => {
    const verification = await rtkAdapter.verify(
      context({ configs: [WIRED], analytics: 'RTK Token Savings (Global Scope)' }),
    );
    assert.equal(
      verification.checks.find((entry) => entry.id === 'analytics-readable')?.status,
      'fail',
    );
    assert.equal(verification.receipt, null);
    assert.equal(verification.achievedTier, 'config-only');
  });

  it('reports not-exercised for the hook when no harness names rtk', async () => {
    const verification = await rtkAdapter.verify(context({}));
    assert.equal(
      verification.checks.find((entry) => entry.id === 'hook-registered')?.status,
      'not-exercised',
    );
  });

  it('fails the executable check and reaches no tier when rtk is gone', async () => {
    const verification = await rtkAdapter.verify(context({ version: null, analytics: null }));
    assert.equal(
      verification.checks.find((entry) => entry.id === 'executable-resolves')?.status,
      'fail',
    );
    assert.equal(verification.achievedTier, null);
  });
});

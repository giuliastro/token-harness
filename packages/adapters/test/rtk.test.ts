/**
 * The RTK adapter — PLAN §10 acceptance.
 *
 * Detection and verification use fake process and database ports, so no installed RTK is
 * required. The load-bearing tests make sure old shared totals cannot be attributed to Claude
 * or Codex, and that each canary comes only from its dedicated database.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileSystemPort,
  HarnessConfigSummary,
  LocalDatabasePort,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import { harnessesWiredToRtk, rtkAdapter, type ProviderContext } from '../src/index.js';

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
          ? 'rtk 0.44.0'
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

function attributionProxyConfig(harness: 'claude' | 'codex'): HarnessConfigSummary {
  return {
    ...WIRED,
    harnessId: harness as HarnessConfigSummary['harnessId'],
    configPath:
      harness === 'claude'
        ? 'C:\\Users\\dev\\.claude\\settings.json'
        : 'C:\\Users\\dev\\.codex\\hooks.json',
    commands: [`token-harness __internal-rtk-hook ${harness}`],
  };
}

function historyDatabase(options: {
  claude?: { count: number; latest: string | null };
  codex?: { count: number; latest: string | null };
}): LocalDatabasePort {
  return {
    query: (query) => {
      const harness = query.path.endsWith('rtk-claude.db')
        ? options.claude
        : query.path.endsWith('rtk-codex.db')
          ? options.codex
          : undefined;
      return Promise.resolve({
        rows:
          harness === undefined
            ? []
            : [
                {
                  operation_count: harness.count,
                  latest_timestamp: harness.latest,
                },
              ],
        failure: null,
        detail: null,
      });
    },
  };
}

const SOMEONE_ELSE: HarnessConfigSummary = {
  ...WIRED,
  matchers: ['Bash'],
  commands: ['"C:\\Users\\dev\\AppData\\Local\\pnpm\\harnesstrim.CMD" hook claude'],
};

function context(
  options: RunnerOptions & {
    configs?: HarnessConfigSummary[];
    now?: string;
    localDatabase?: LocalDatabasePort | null;
  },
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
    localDatabase: options.localDatabase ?? null,
    // Fixed rather than derived: these tests assert the mapping, and a real salted digest
    // would make every expectation a copy of the implementation.
    projectIdFor: (path) => `p_${path.length.toString(16)}`,
  };
}

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
    assert.equal(detection.version, '0.44.0');
    assert.equal(detection.versionVerdict, 'in-range');
    assert.equal(detection.executable, 'C:\\tools\\rtk.exe');
  });

  it('accepts the live-validated RTK 0.48.0 build as in range', async () => {
    const detection = await rtkAdapter.detect(context({ version: 'rtk 0.48.0' }));
    assert.equal(detection.version, '0.48.0');
    assert.equal(detection.versionVerdict, 'in-range');
    assert.deepEqual(detection.warnings, []);
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

  it('keeps a future RTK release usable when the managed runtime surface is still assignable', async () => {
    const detection = await rtkAdapter.detect(context({ version: 'rtk 9.9.9' }));
    assert.equal(detection.versionVerdict, 'in-range');
    assert.equal(
      detection.warnings.some((entry) => entry.code === 'provider-version-unknown-newer'),
      false,
    );
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

  it('offers Codex hook setup only on RTK 0.50.0', async () => {
    const old = await rtkAdapter.detect(context({ version: 'rtk 0.49.0' }));
    assert.deepEqual(old.assignableHarnesses, ['claude']);

    const detection = await rtkAdapter.detect(context({ version: 'rtk 0.50.0' }));
    assert.deepEqual(detection.assignableHarnesses, ['claude', 'codex']);
  });

  it('marks Codex configuration broken when installed RTK predates the native hook', async () => {
    const config: HarnessConfigSummary = {
      ...WIRED,
      harnessId: 'codex' as HarnessConfigSummary['harnessId'],
      configPath: 'C:\\Users\\dev\\.codex\\hooks.json',
      commands: ['rtk hook codex'],
    };
    const detection = await rtkAdapter.detect(
      context({ version: 'rtk 0.49.0', configs: [config] }),
    );
    assert.equal(detection.state, 'broken');
    assert.ok(detection.warnings.some((warning) => warning.code === 'rtk-codex-hook-unsupported'));
  });

  it('does not claim a managed surface it does not have', async () => {
    // RFC 0002 §Providers may exceed the managed surface. Every harness named by RTK's
    // manifest here is managed by Token Harness, so none is reported as unmanaged context.
    const detection = await rtkAdapter.detect(context({}));
    assert.equal(detection.supportsUnmanagedHarnesses, false);
    assert.deepEqual(detection.unmanagedHarnessesConfigured, []);
  });
});

describe('per-harness verification', () => {
  it('does not infer Claude activity from RTK shared totals', async () => {
    const verification = await rtkAdapter.verify(
      context({
        configs: [WIRED],
        analytics: analyticsDocument([{ date: '2026-07-30', commands: 500 }]),
      }),
    );
    assert.equal(verification.receipt, null);
    assert.equal(verification.achievedTier, 'config-only');
    assert.equal(
      verification.checks.find((entry) => entry.id === 'rtk-attribution-claude')?.status,
      'not-exercised',
    );
  });

  it('records a Claude canary only from the Claude-specific history', async () => {
    const verification = await rtkAdapter.verify(
      context({
        configs: [attributionProxyConfig('claude')],
        localDatabase: historyDatabase({
          claude: { count: 17, latest: '2026-07-30T10:15:00.000Z' },
        }),
      }),
    );
    assert.equal(verification.achievedTier, 'canary');
    assert.deepEqual(verification.receipt, {
      observedAt: '2026-07-30T10:15:00.000Z',
      operations: 17,
      source: 'RTK per-agent history (claude)',
      harnessId: 'claude',
    });
    assert.equal(
      verification.checks.find((entry) => entry.id === 'rtk-attribution-claude')?.status,
      'pass',
    );
  });

  it('does not claim Codex hook activity on RTK 0.49.0', async () => {
    const codex: HarnessConfigSummary = {
      ...WIRED,
      harnessId: 'codex' as HarnessConfigSummary['harnessId'],
      configPath: 'C:\\Users\\dev\\.codex\\hooks.json',
      commands: ['token-harness __internal-rtk-hook codex'],
    };
    const verification = await rtkAdapter.verify(
      context({ version: 'rtk 0.49.0', configs: [codex] }),
    );
    assert.equal(verification.receipt, null);
    assert.equal(
      verification.checks.find((entry) => entry.id === 'rtk-attribution-codex')?.status,
      'fail',
    );
  });

  it('records a Codex canary from Codex-specific history on RTK 0.50.0', async () => {
    const verification = await rtkAdapter.verify(
      context({
        version: 'rtk 0.50.0',
        configs: [attributionProxyConfig('codex')],
        localDatabase: historyDatabase({
          codex: { count: 23, latest: '2026-07-30T11:15:00.000Z' },
        }),
      }),
    );
    assert.equal(verification.achievedTier, 'canary');
    assert.equal(verification.receipt?.harnessId, 'codex');
    assert.equal(verification.receipt?.operations, 23);
    assert.equal(
      verification.checks.find((entry) => entry.id === 'rtk-attribution-codex')?.status,
      'pass',
    );
  });

  it('reports not-exercised for the hook when no harness names RTK', async () => {
    const verification = await rtkAdapter.verify(context({}));
    assert.equal(
      verification.checks.find((entry) => entry.id === 'hook-registered')?.status,
      'not-exercised',
    );
  });

  it('fails the executable check and reaches no tier when RTK is gone', async () => {
    const verification = await rtkAdapter.verify(context({ version: null, analytics: null }));
    assert.equal(
      verification.checks.find((entry) => entry.id === 'executable-resolves')?.status,
      'fail',
    );
    assert.equal(verification.achievedTier, null);
  });
});

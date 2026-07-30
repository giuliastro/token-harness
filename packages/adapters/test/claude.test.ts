/**
 * The Claude Code adapter — PLAN §3.3 acceptance.
 *
 * "Absent, partial, healthy, broken, and user-modified fixtures" plus "the brownfield
 * adoption fixtures from RFC 0004", and "no live harness required for unit/integration
 * tests".
 *
 * The filesystem is an in-memory `FileSystemPort` and the process runner is
 * `FakeProcessRunner`'s contract implemented inline, so nothing here can reach the
 * developer's home even by mistake — which is the reason the adapter takes ports rather
 * than importing `node:fs`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileStat,
  FileSystemPort,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import { claudeAdapter, matcherCoversFamily, type HarnessContext } from '../src/index.js';

const WINDOWS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const LINUX: PlatformFacts = { ...WINDOWS, os: 'linux', osDisplayName: 'Ubuntu 24.04' };

/** POSIX joins throughout: the adapter never builds a path itself, so `/` is enough. */
function memoryFileSystem(files: Readonly<Record<string, string>>): FileSystemPort {
  const encoder = new TextEncoder();
  return {
    join: (...segments) => segments.join('/'),
    dirname: (path) => path.split('/').slice(0, -1).join('/'),
    basename: (path) => path.split('/').pop() ?? path,
    isInside: (candidate, parent) => candidate.startsWith(parent),
    stat: (path): Promise<FileStat | null> =>
      Promise.resolve(
        Object.hasOwn(files, path)
          ? { kind: 'file', byteLength: files[path]?.length ?? 0, mode: null }
          : null,
      ),
    readFile: (path) => Promise.resolve(encoder.encode(files[path] ?? '')),
    writeFile: () => Promise.reject(new Error('the detection path must not write')),
    createDirectory: () => Promise.reject(new Error('the detection path must not write')),
    remove: () => Promise.reject(new Error('the detection path must not write')),
    readDirectory: () => Promise.resolve([]),
  };
}

function versionRunner(stdout: string | null): ProcessRunner {
  return {
    run: (request: ProcessRequest): Promise<ProcessOutcome> =>
      Promise.resolve({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: stdout === null ? null : '/usr/local/bin/claude',
        exitCode: stdout === null ? null : 0,
        signal: null,
        stdout: stdout ?? '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure:
          stdout === null ? { reason: 'executable-not-found', message: 'no claude on PATH' } : null,
      }),
  };
}

const HOME = '/home/dev';
const PROJECT = '/home/dev/project';
const USER_SETTINGS = `${HOME}/.claude/settings.json`;
const PROJECT_SETTINGS = `${PROJECT}/.claude/settings.json`;

function context(options: {
  files?: Readonly<Record<string, string>>;
  version?: string | null;
  facts?: PlatformFacts;
}): HarnessContext {
  return {
    fs: memoryFileSystem(options.files ?? {}),
    runner: versionRunner(
      options.version === undefined ? '2.1.212 (Claude Code)' : options.version,
    ),
    facts: options.facts ?? LINUX,
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

/** The shape the Phase 2.5 spike read off a real machine. */
const LIVE_SETTINGS = JSON.stringify(
  {
    autoUpdatesChannel: 'latest',
    theme: 'dark',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }],
    },
  },
  null,
  2,
);

describe('detection', () => {
  it('reports absent when neither the executable nor a settings file exists', async () => {
    const detection = await claudeAdapter.detect(context({ version: null }));
    assert.equal(detection.state, 'absent');
    assert.equal(detection.version, null);
    assert.equal(detection.configPath, null);
    assert.deepEqual(detection.warnings, []);
  });

  it('reports detected when the executable runs but nothing is configured', async () => {
    const detection = await claudeAdapter.detect(context({}));
    assert.equal(detection.state, 'detected');
    assert.equal(detection.version, '2.1.212');
    assert.equal(detection.versionVerdict, 'in-range');
    assert.equal(detection.declaredVerificationTier, 'canary');
  });

  it('reports detected, not configured, when a settings file has no hooks', async () => {
    const detection = await claudeAdapter.detect(
      context({ files: { [USER_SETTINGS]: '{ "theme": "dark" }' } }),
    );
    assert.equal(detection.state, 'detected');
    assert.equal(detection.configPath, USER_SETTINGS);
  });

  it('reports configured when a hook entry is declared and the executable runs', async () => {
    const detection = await claudeAdapter.detect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS } }),
    );
    assert.equal(detection.state, 'configured');
    assert.equal(detection.configPath, USER_SETTINGS);
    assert.ok(
      detection.evidence.some(
        (item) => item.kind === 'config-entry' && item.detail.includes('pre-tool-use'),
      ),
    );
    // RFC 0002 §Detection: a configuration string alone is not detection, so the
    // corroborating version evidence has to be there too.
    assert.ok(detection.evidence.some((item) => item.kind === 'version-output'));
  });

  /**
   * RFC 0002 §Detection forbids inferring success from configuration alone, so a settings
   * file with hooks and no runnable executable is `detected` with a warning rather than
   * `configured`. It says exactly what was seen: someone configured this here, and it is
   * not installed.
   */
  it('refuses to call a machine configured when the executable cannot be run', async () => {
    const detection = await claudeAdapter.detect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS }, version: null }),
    );
    assert.equal(detection.state, 'detected');
    assert.deepEqual(
      detection.warnings.map((entry) => entry.code),
      ['harness-executable-missing'],
    );
  });

  it('reports broken when a settings file is not valid JSON', async () => {
    const detection = await claudeAdapter.detect(
      context({ files: { [USER_SETTINGS]: '{ "hooks": }' } }),
    );
    assert.equal(detection.state, 'broken');
    assert.deepEqual(
      detection.warnings.map((entry) => entry.code),
      ['harness-config-unreadable'],
    );
    assert.equal(detection.warnings[0]?.severity, 'error');
    assert.equal(detection.warnings[0]?.path, USER_SETTINGS);
  });

  it('finds a project-scoped settings file as well as the user one', async () => {
    const detection = await claudeAdapter.detect(
      context({ files: { [PROJECT_SETTINGS]: LIVE_SETTINGS } }),
    );
    assert.equal(detection.state, 'configured');
    assert.equal(detection.configPath, PROJECT_SETTINGS);
  });

  it('warns and stays conservative on a version newer than anything observed', async () => {
    const detection = await claudeAdapter.detect(context({ version: '9.9.9 (Claude Code)' }));
    assert.equal(detection.versionVerdict, 'unknown-newer');
    assert.deepEqual(
      detection.warnings.map((entry) => entry.code),
      ['harness-version-unknown-newer'],
    );
    assert.equal(detection.warnings[0]?.severity, 'warning');
  });

  it('reports below-range for a version older than the schema observed', async () => {
    const detection = await claudeAdapter.detect(context({ version: '1.4.0 (Claude Code)' }));
    assert.equal(detection.versionVerdict, 'below-range');
  });

  it('records that the version output was unusable rather than inventing one', async () => {
    const detection = await claudeAdapter.detect(context({ version: 'Claude Code (dev build)' }));
    assert.equal(detection.version, null);
    assert.ok(
      detection.evidence.some(
        (item) => item.kind === 'version-output' && item.detail.includes('no recognisable'),
      ),
    );
  });
});

describe('tool-family coverage', () => {
  it('reports the PowerShell family as uncovered by a Bash matcher on Windows', async () => {
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS }, facts: WINDOWS }),
    );
    // The measured finding from the Phase 2.5 spike, now a reported diagnostic.
    assert.deepEqual(inspection.uncoveredToolFamilies, ['PowerShell']);
    assert.deepEqual(
      inspection.diagnostics.map((entry) => entry.code),
      ['tool-family-not-covered'],
    );
    assert.equal(inspection.diagnostics[0]?.severity, 'warning');
  });

  it('reports nothing uncovered on a platform without that family', async () => {
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS }, facts: LINUX }),
    );
    assert.deepEqual(inspection.uncoveredToolFamilies, []);
    assert.deepEqual(inspection.diagnostics, []);
    assert.deepEqual(
      inspection.activeToolFamilies.map((family) => family.id),
      ['Bash'],
    );
  });

  it('accepts a matcher that covers both families', async () => {
    const settings = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [] }] },
    });
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: settings }, facts: WINDOWS }),
    );
    assert.deepEqual(inspection.uncoveredToolFamilies, []);
  });

  it('reports nothing uncovered when nothing is configured at all', async () => {
    // An unconfigured harness has no coverage gap; it has no integration.
    const inspection = await claudeAdapter.inspect(context({ facts: WINDOWS }));
    assert.deepEqual(inspection.uncoveredToolFamilies, []);
  });

  it('declares no enablement state, because a hook here runs once written', async () => {
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS } }),
    );
    assert.equal(claudeAdapter.manifest.requiresEnablement, false);
    assert.equal(inspection.enabled, null);
  });
});

describe('matcher interpretation', () => {
  const covering: ReadonlyArray<readonly [string, string]> = [
    ['Bash', 'Bash'],
    ['^Bash$', 'Bash'],
    ['Bash|PowerShell', 'PowerShell'],
    ['.*', 'Bash'],
  ];
  for (const [matcher, family] of covering) {
    it(`${matcher} covers ${family}`, () => {
      assert.equal(matcherCoversFamily(matcher, family), true);
    });
  }

  const notCovering: ReadonlyArray<readonly [string, string]> = [
    ['Bash', 'PowerShell'],
    ['^Bash$', 'PowerShell'],
    ['Read', 'Bash'],
  ];
  for (const [matcher, family] of notCovering) {
    it(`${matcher} does not cover ${family}`, () => {
      assert.equal(matcherCoversFamily(matcher, family), false);
    });
  }

  it('treats a matcher it cannot interpret as covering nothing', () => {
    // Understating coverage is safe; overstating it is what RFC 0005 exists to prevent.
    assert.equal(matcherCoversFamily('[unclosed', 'Bash'), false);
  });
});

describe('verification', () => {
  it('reaches config-only and reports the canary as not-exercised', async () => {
    const verification = await claudeAdapter.verify(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS }, facts: LINUX }),
    );
    assert.equal(verification.declaredTier, 'canary');
    // RFC 0007: the receipt for this harness is provider-side, and no provider adapter
    // exists yet. Claiming `canary` here would assert interception on no evidence.
    assert.equal(verification.achievedTier, 'config-only');

    const byId = new Map(verification.checks.map((check) => [check.id, check]));
    assert.equal(byId.get('executable-resolves')?.status, 'pass');
    assert.equal(byId.get('settings-readable')?.status, 'pass');
    assert.equal(byId.get('hook-registered')?.status, 'pass');
    assert.equal(byId.get('tool-families-covered')?.status, 'pass');
    assert.equal(byId.get('canary-intercepted')?.status, 'not-exercised');
  });

  it('fails the coverage check on Windows with a Bash-only matcher', async () => {
    const verification = await claudeAdapter.verify(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS }, facts: WINDOWS }),
    );
    const check = verification.checks.find((entry) => entry.id === 'tool-families-covered');
    assert.equal(check?.status, 'fail');
    assert.match(check?.summary ?? '', /PowerShell/);
    assert.notEqual(check?.remediation, null);
  });

  it('reports not-exercised rather than pass on an unconfigured machine', async () => {
    const verification = await claudeAdapter.verify(context({}));
    const byId = new Map(verification.checks.map((check) => [check.id, check]));
    assert.equal(byId.get('settings-readable')?.status, 'not-exercised');
    assert.equal(byId.get('hook-registered')?.status, 'not-exercised');
    assert.equal(verification.achievedTier, 'presence');
  });

  it('fails the executable check when claude cannot be run', async () => {
    const verification = await claudeAdapter.verify(context({ version: null }));
    const check = verification.checks.find((entry) => entry.id === 'executable-resolves');
    assert.equal(check?.status, 'fail');
    assert.equal(verification.achievedTier, null);
  });

  it('fails the readable check on a broken settings file', async () => {
    const verification = await claudeAdapter.verify(
      context({ files: { [USER_SETTINGS]: 'not json' } }),
    );
    assert.equal(
      verification.checks.find((entry) => entry.id === 'settings-readable')?.status,
      'fail',
    );
  });
});

/** RFC 0004 §Brownfield adoption: the most likely first run is not a clean machine. */
describe('brownfield adoption', () => {
  it('reports a hand-configured provider as configured, never as absent', async () => {
    const detection = await claudeAdapter.detect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS } }),
    );
    assert.equal(detection.state, 'configured');
  });

  it('reads a hook entry it does not own without complaining about it', async () => {
    // RFC 0004 clause 1: detection reports the existing installation. Whether Token
    // Harness owns that entry is a planning question, and nothing here overwrites it.
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS }, facts: LINUX }),
    );
    const user = inspection.configs.find((config) => config.path === USER_SETTINGS);
    assert.deepEqual(user?.configuredPoints, ['pre-tool-use']);
    assert.deepEqual(user?.matchers, ['Bash']);
  });

  it('preserves the user keys it read past, because it only ever reads', async () => {
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS } }),
    );
    // The in-memory port rejects every write, so reaching this line at all is the
    // assertion: detection and inspection are read-only, per RFC 0004 §Command behavior.
    assert.equal(inspection.harnessId, 'claude');
  });

  it('handles both a user and a project file carrying entries', async () => {
    const inspection = await claudeAdapter.inspect(
      context({ files: { [USER_SETTINGS]: LIVE_SETTINGS, [PROJECT_SETTINGS]: LIVE_SETTINGS } }),
    );
    assert.equal(
      inspection.configs.filter((config) => config.configuredPoints.length > 0).length,
      2,
    );
  });
});

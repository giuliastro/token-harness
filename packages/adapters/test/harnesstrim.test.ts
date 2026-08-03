/**
 * HarnessTrim — PLAN §11 acceptance and RFC 0005 §Importers §HarnessTrim.
 *
 * The `TrimEvent` shape here is RFC 0005's, field for field, and the facts the adapter is built on
 * are the ones this machine supplied: HarnessTrim exposes no version command, and its telemetry is
 * opt-in and usually absent.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileStat,
  HarnessConfigSummary,
  ImportCursor,
  MetricsStore,
  OptimizationEvent,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  VerificationReceipt,
} from '@token-harness/core';

import {
  claudeAdapter,
  harnesstrimAdapter,
  harnessesWiredToHarnessTrim,
  synthesizeEventId,
  type ProviderContext,
} from '../src/index.js';

const HOME = 'C:\\Users\\dev';
const PROJECT = 'C:\\work\\demo';
const METRICS = `${PROJECT}\\.harnesstrim\\metrics.jsonl`;
const HERMES_METRICS = `${HOME}\\.hermes\\harnesstrim-metrics.jsonl`;
const CLAUDE_MD = `${PROJECT}\\CLAUDE.md`;
const AGENTS = `${PROJECT}\\AGENTS.md`;

const FACTS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11 Pro',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

/** One `TrimEvent`, exactly the shape RFC 0005 records for `0.0.5`. */
function trimEvent(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    ts: '2026-07-31T10:00:00.000Z',
    harness: 'claude',
    tool: 'bash',
    reducer: 'npm-test',
    beforeChars: 4000,
    afterChars: 900,
    ...overrides,
  });
}

interface Options {
  files?: Record<string, string>;
  runnable?: boolean;
  configs?: HarnessConfigSummary[];
  /** What `--version` prints. Null makes the build reject the flag, as older ones do. */
  version?: string | null;
}

function context(options: Options = {}): ProviderContext {
  const files = options.files ?? {};
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
      run: (request: ProcessRequest): Promise<ProcessOutcome> => {
        const asksVersion = request.args.includes('--version');
        // `version: null` models the older build, which rejects the unknown option with a non-zero
        // exit — a different thing from not being installed, and the distinction the probe exists
        // to draw.
        const declared = options.version === undefined ? '0.0.5' : options.version;
        const rejects = asksVersion && declared === null;
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
          executablePath: options.runnable === false ? null : `${HOME}\\pnpm\\harnesstrim.CMD`,
          exitCode: options.runnable === false ? null : rejects ? 1 : 0,
          signal: null,
          stdout:
            options.runnable === false
              ? ''
              : asksVersion
                ? (declared ?? '')
                : 'harnesstrim — one token policy',
          stderr: rejects ? "Unknown option '--version'" : '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure:
            options.runnable === false
              ? { reason: 'executable-not-found', message: 'missing' }
              : null,
        });
      },
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
    harnessConfigs: options.configs ?? [],
    now: () => '2026-07-31T12:00:00.000Z',
    localDatabase: null,
    projectIdFor: () => 'p_test',
  };
}

function wired(harness: string, command = 'harnesstrim hook codex'): HarnessConfigSummary {
  return {
    harnessId: harness as HarnessConfigSummary['harnessId'],
    configPath: `${HOME}\\.${harness}\\hooks.json`,
    scope: 'user',
    interceptionPoints: ['post-tool-use'],
    matchers: ['Bash'],
    commands: [command],
  };
}

interface FakeStore extends MetricsStore {
  readonly events: OptimizationEvent[];
  readonly cursors: ImportCursor[];
}

function store(existing: ImportCursor | null = null): FakeStore {
  const events: OptimizationEvent[] = [];
  const cursors: ImportCursor[] = [];
  return {
    events,
    cursors,
    appendEvents: (batch) => {
      events.push(...batch);
      return Promise.resolve();
    },
    readCursor: () => Promise.resolve(cursors.at(-1) ?? existing),
    writeCursor: (cursor) => {
      cursors.push(cursor);
      return Promise.resolve();
    },
    query: async function* () {
      // Nothing yields: the importer never reads events back.
    },
    upsertReceipt: (_receipt: VerificationReceipt) => Promise.resolve(),
  };
}

describe('detection', () => {
  it('reports the version when the build has the command', async () => {
    // Upstream shipped `--version` after this adapter first assumed it did not exist. Asking is the
    // only way a detector stays true across releases.
    const detection = await harnesstrimAdapter.detect(context());
    assert.equal(detection.version, '0.0.5');
    assert.equal(detection.versionVerdict, 'in-range');
    assert.match(detection.evidence.map((entry) => entry.detail).join(' '), /reported 0\.0\.5/);
  });

  it('reports no version, and stays installed, when the build rejects the flag', async () => {
    const detection = await harnesstrimAdapter.detect(context({ version: null }));
    /**
     * The state the adapter used to hardcode. A non-zero exit from an unknown option is not absence:
     * `--help` still succeeds, so the tool is installed and simply cannot say which version it is.
     */
    assert.equal(detection.version, null);
    assert.equal(detection.state, 'installed');
    // No verdict, so `doctor` reports no version problem — an unreadable version is not an
    // out-of-range one, and treating it as one would exit 3 on every older build.
    assert.equal(detection.versionVerdict, null);
    assert.match(detection.evidence.map((entry) => entry.detail).join(' '), /rejects --version/);
  });

  it('judges a version outside the tested range', async () => {
    const detection = await harnesstrimAdapter.detect(context({ version: '9.9.9' }));
    assert.equal(detection.versionVerdict, 'unknown-newer');
  });

  it('is installed when runnable and wired to nothing', async () => {
    assert.equal((await harnesstrimAdapter.detect(context())).state, 'installed');
  });

  it('is configured when a harness names it', async () => {
    const detection = await harnesstrimAdapter.detect(context({ configs: [wired('codex')] }));
    assert.equal(detection.state, 'configured');
    assert.deepEqual(detection.configuredHarnesses, ['codex']);
  });

  it('is absent when it cannot be run and nothing names it', async () => {
    assert.equal((await harnesstrimAdapter.detect(context({ runnable: false }))).state, 'absent');
  });

  it('is broken when a hook names it and it cannot be run', async () => {
    const detection = await harnesstrimAdapter.detect(
      context({ runnable: false, configs: [wired('codex')] }),
    );
    // RFC 0002 §Detection: the integration is present and cannot work, which is a different state
    // from absent and a different one from configured.
    assert.equal(detection.state, 'broken');
    assert.equal(detection.warnings[0]?.code, 'provider-configured-but-missing');
  });

  it('is never managed by Token Harness', async () => {
    const detection = await harnesstrimAdapter.detect(context({ configs: [wired('codex')] }));
    // Structural rather than circumstantial: PLAN §11 says Token Harness never installs it, so
    // every installation it can ever see is the user's.
    assert.equal(detection.managedByTokenHarness, false);
  });

  it('reports a wired harness it does not manage, and leaves it alone', async () => {
    const detection = await harnesstrimAdapter.detect(context({ configs: [wired('hermes')] }));
    // RFC 0002 §Providers may exceed the managed surface. HarnessTrim ships Hermes and Pi adapters
    // that Token Harness does not manage.
    assert.equal(detection.supportsUnmanagedHarnesses, true);
    assert.deepEqual(detection.unmanagedHarnessesConfigured, ['hermes']);
  });

  it('recognises the Windows batch shim by name', () => {
    assert.deepEqual(
      harnessesWiredToHarnessTrim([
        wired('codex', '"C:\\Users\\dev\\AppData\\Local\\pnpm\\harnesstrim.CMD" hook codex'),
      ]),
      ['codex'],
    );
    assert.deepEqual(harnessesWiredToHarnessTrim([wired('claude', 'rtk hook claude')]), []);
  });
});

describe('the metrics importer', () => {
  it('reports unavailable when telemetry was never enabled', async () => {
    const result = await harnesstrimAdapter.collectMetrics(context(), store());
    // `--metrics` is opt-in. RFC 0005 §Importer degradation policy: a degraded mode "is a supported
    // steady state, not a warning".
    assert.equal(result.mode, 'unavailable');
    assert.equal(result.diagnostics[0]?.severity, 'info');
    assert.equal(result.cursor, null);
  });

  it('imports character-only events as estimated-local with no tokens', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n` } }),
      target,
    );

    assert.equal(result.mode, 'legacy');
    assert.equal(result.imported, 1);
    const event = target.events[0];
    assert.ok(event);
    assert.equal(event.measurement.class, 'estimated-local');
    assert.equal(event.measurement.beforeChars, 4000);
    assert.equal(event.measurement.afterChars, 900);
    // RFC 0005: tokens are "never derived silently". `0.0.5` counts characters.
    assert.equal(event.measurement.beforeTokens, null);
    assert.equal(event.measurement.tokenizer, null);
    assert.equal(event.outcome.changed, true);
  });

  it('reads the harness from the event rather than guessing it', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent({ harness: 'opencode', tool: 'read' })}\n` } }),
      target,
    );
    // Unlike RTK's database, a `TrimEvent` names its harness, so this is read and not `unknown`.
    assert.equal(target.events[0]?.context.harnessId, 'opencode');
    assert.equal(target.events[0]?.context.toolFamily, 'read');
    // And OpenCode's reduction is a generic tool result, not shell output.
    assert.equal(target.events[0]?.context.capability, 'tool.output.reduce');
  });

  it('files a dryrun event as counterfactual and not as a saving', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent({ mode: 'dryrun' })}\n` } }),
      target,
    );
    const event = target.events[0];
    assert.ok(event);
    /**
     * RFC 0005 §A measured reduction is not always a realized one. The OpenCode adapter emits an
     * event in `dryrun` with identical figures and leaves `output.output` untouched, so filing it as
     * `estimated-local` "would inflate reported savings with output the model actually received".
     */
    assert.equal(event.measurement.class, 'counterfactual');
    assert.equal(event.outcome.changed, false);
    assert.equal(event.outcome.bypassReason, 'dryrun');
  });

  it('records a reduction that changed nothing as a bypass', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent({ beforeChars: 100, afterChars: 100 })}\n` } }),
      target,
    );
    assert.equal(target.events[0]?.outcome.changed, false);
    assert.equal(target.events[0]?.outcome.bypassReason, 'no-reduction-applied');
  });

  it('reads the declared location and ignores a home path naming an unregistered harness', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({
        files: {
          [METRICS]: `${trimEvent()}\n`,
          // A Hermes file can exist on the machine without Hermes being in the registry: it is
          // present, and it is not read. PLAN §15 item 25 removes the location until item 30 admits
          // the harness; the registry assertion in `registries.test.ts` refuses to reintroduce it.
          [HERMES_METRICS]: `${trimEvent({ harness: 'hermes' })}\n`,
        },
      }),
      target,
    );
    assert.equal(result.imported, 1);
    assert.deepEqual(
      target.events.map((event) => event.context.harnessId),
      ['claude'],
    );
  });

  it('resumes from the stored byte offset', async () => {
    const first = `${trimEvent()}\n`;
    const second = `${trimEvent({ ts: '2026-07-31T11:00:00.000Z' })}\n`;
    const target = store();
    await harnesstrimAdapter.collectMetrics(context({ files: { [METRICS]: first } }), target);
    assert.equal(target.events.length, 1);

    const again = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: first + second } }),
      target,
    );
    // Only the new line: RFC 0005 makes the file the ordering authority and the offset the resume
    // point.
    assert.equal(again.imported, 1);
  });

  it('imports nothing when the file has not grown', async () => {
    const text = `${trimEvent()}\n`;
    const target = store();
    await harnesstrimAdapter.collectMetrics(context({ files: { [METRICS]: text } }), target);
    const again = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: text } }),
      target,
    );
    assert.equal(again.imported, 0);
    assert.equal(again.mode, 'legacy');
  });

  it('restarts when the file was replaced, and says so', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n${trimEvent()}\n` } }),
      target,
    );

    // Same length, different content: the digest of the last imported line no longer matches, which
    // RFC 0005 says "means the file was truncated or replaced".
    const replaced = `${trimEvent({ tool: 'read' })}\n${trimEvent({ tool: 'read' })}\n`;
    const again = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: replaced } }),
      target,
    );
    assert.equal(
      again.diagnostics.some((entry) => entry.code === 'provider-metrics-source-reset'),
      true,
    );
    assert.equal(again.imported, 2);
  });

  it('restarts when the file shrank', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n${trimEvent()}\n` } }),
      target,
    );
    const again = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n` } }),
      target,
    );
    assert.equal(again.imported, 1);
    assert.equal(
      again.diagnostics.some((entry) => entry.code === 'provider-metrics-source-reset'),
      true,
    );
  });

  it('leaves a torn final line for the next run instead of skipping it', async () => {
    const target = store();
    const torn = `${trimEvent()}\n{"ts":"2026-07-31T11:00`;
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: torn } }),
      target,
    );
    // A partial append is what JSONL tolerates by design, so it is not counted as skipped and the
    // cursor stops before it.
    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.cursor?.byteOffset, `${trimEvent()}\n`.length);
  });

  it('warns about a line in the middle it cannot read', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n{ not json\n${trimEvent()}\n` } }),
      target,
    );
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 1);
    // Corruption in the middle is a warning, unlike a degraded mode: a savings total quietly
    // missing records is the failure RFC 0005 exists to prevent.
    const warning = result.diagnostics.find(
      (entry) => entry.code === 'provider-metrics-rows-skipped',
    );
    assert.equal(warning?.severity, 'warning');
  });

  it('uses the file-shaped cursor members, and no high-water mark', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n` } }),
      target,
    );
    // This is the source `ImportCursor` was designed for, so unlike RTK's database every
    // file-shaped member is used.
    assert.ok((result.cursor?.byteOffset ?? 0) > 0);
    assert.match(result.cursor?.lastLineDigest ?? '', /^sha256:/);
    assert.equal(result.cursor?.highWaterMark, null);
  });
});

describe('the synthesized identity', () => {
  it('is a hash of the source, the ordinal, and the line', () => {
    // RFC 0005 §Deduplicating a stream without event IDs requires all three: two identical lines
    // can be two real events, and `ts` "is not unique under concurrency".
    const line = trimEvent();
    assert.notEqual(synthesizeEventId('a', 0, line), synthesizeEventId('b', 0, line));
    assert.notEqual(synthesizeEventId('a', 0, line), synthesizeEventId('a', 1, line));
    assert.notEqual(synthesizeEventId('a', 0, line), synthesizeEventId('a', 0, `${line} `));
    assert.equal(synthesizeEventId('a', 0, line), synthesizeEventId('a', 0, line));
  });

  it('reproduces the same id for the same line after a restart', async () => {
    const two = `${trimEvent()}\n${trimEvent({ tool: 'read' })}\n`;
    const first = store();
    await harnesstrimAdapter.collectMetrics(context({ files: { [METRICS]: two } }), first);

    // A fresh store, as though the import had never happened. The ordinal counts from the start of
    // the file rather than from the slice, so a restart produces the identities that let the store
    // discard what it already has.
    const second = store();
    await harnesstrimAdapter.collectMetrics(context({ files: { [METRICS]: two } }), second);
    assert.deepEqual(
      first.events.map((event) => event.eventId),
      second.events.map((event) => event.eventId),
    );
  });
});

describe('verification', () => {
  it('reaches config-only when wired, without claiming interception', async () => {
    const result = await harnesstrimAdapter.verify(context({ configs: [wired('codex')] }));
    assert.equal(result.declaredTier, 'config-only');
    assert.equal(result.achievedTier, 'config-only');
    assert.equal(
      result.checks.find((check) => check.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
    assert.equal(result.receipt, null);
  });

  it('reads its own telemetry as a passive receipt', async () => {
    const result = await harnesstrimAdapter.verify(
      context({ configs: [wired('codex')], files: { [METRICS]: `${trimEvent()}\n` } }),
    );
    // RFC 0007 §Active and passive canaries: the provider witnessing its own interception.
    assert.equal(result.achievedTier, 'canary');
    assert.equal(result.receipt?.observedAt, '2026-07-31T10:00:00.000Z');
    assert.equal(result.receipt?.operations, 1);
  });

  it('reports the instruction path when AGENTS.md carries it', async () => {
    const result = await harnesstrimAdapter.verify(
      context({
        configs: [wired('codex')],
        files: { [AGENTS]: 'Pipe noisy output through harnesstrim reduce.\n' },
      }),
    );
    /**
     * RFC 0003 §The instruction-level path: guidance in `AGENTS.md` is a second shell-reduction path
     * that hook ownership does not cover, because it works through the model's behaviour rather than
     * an interception point. `verify` "checks which instruction text is actually present".
     */
    const check = result.checks.find((entry) => entry.id === 'instruction-path-present');
    assert.equal(check?.status, 'info');
  });

  it('says nothing about AGENTS.md when it does not name harnesstrim', async () => {
    const result = await harnesstrimAdapter.verify(
      context({ configs: [wired('codex')], files: { [AGENTS]: '# Project notes\n' } }),
    );
    assert.equal(
      result.checks.some((entry) => entry.id === 'instruction-path-present'),
      false,
    );
  });

  it('fails the executable check when it cannot be run', async () => {
    const result = await harnesstrimAdapter.verify(context({ runnable: false }));
    assert.equal(result.checks[0]?.status, 'fail');
    assert.equal(result.achievedTier, null);
  });
});

describe('planning', () => {
  it('plans nothing without Claude Code in scope', async () => {
    const result = await harnesstrimAdapter.plan(context(), {
      ownership: [],
      harnesses: [],
      desiredState: 'configured',
    });
    assert.deepEqual(result.actions, []);
  });

  it('delegates the reviewed 0.0.7 Claude skills-only invocation', async () => {
    const result = await harnesstrimAdapter.plan(context({ version: '0.0.7' }), {
      ownership: [],
      harnesses: [claudeAdapter.manifest],
      desiredState: 'configured',
    });
    const action = result.actions[0];
    assert.ok(action !== undefined && action.kind === 'delegated-provider-install');
    assert.deepEqual(action.args, [
      'install',
      'claude',
      PROJECT,
      '--apply',
      '--no-hook',
      '--no-instructions',
    ]);
    assert.equal(action.expectedArtifacts.length, 7);
    assert.deepEqual(
      action.expectedArtifacts.find((artifact) =>
        artifact.path.endsWith('\\delta-response\\references\\examples.md'),
      ),
      {
        path: `${PROJECT}\\.claude\\skills\\delta-response\\references\\examples.md`,
        digest: 'sha256:c67a1f57e63550b396043c3072b7e1a3a0c1522376471f53d6829253339e64e7',
      },
    );
    assert.deepEqual(action.protectedPaths, [`${PROJECT}\\.claude\\settings.json`, CLAUDE_MD]);
  });

  it('plans removal of the reviewed skills only when Claude Code is in scope', async () => {
    const result = await harnesstrimAdapter.plan(context(), {
      ownership: [],
      harnesses: [claudeAdapter.manifest],
      desiredState: 'absent',
    });
    assert.equal(result.actions.length, 7);
    assert.equal(
      result.actions.every((action) => action.kind === 'remove-owned-change'),
      true,
    );
  });
});

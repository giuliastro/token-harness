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
  compareCapabilities,
  harnesstrimAdapter,
  harnessesWiredToHarnessTrim,
  synthesizeEventId,
  type HarnessTrimCapabilities,
  type HarnessTrimHarnessCapabilities,
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

/** One native `TrimEvent` in the `0.1.0` shape: schema envelope, producer id, nullable tokens. */
function nativeTrimEvent(
  overrides: Partial<Record<string, unknown>> = {},
  eventId = '3f8c9a91-7c2d-4a1e-9f6b-5d4e8c2a1b00',
): string {
  return JSON.stringify({
    schemaVersion: 1,
    eventId,
    ts: '2026-08-01T10:00:00.000Z',
    harness: 'opencode',
    tool: 'bash',
    reducer: 'test-output-slim',
    beforeChars: 1410,
    afterChars: 124,
    changed: true,
    beforeTokens: null,
    afterTokens: null,
    ...overrides,
  });
}

interface Options {
  files?: Record<string, string>;
  runnable?: boolean;
  configs?: HarnessConfigSummary[];
  /** What `--version` prints. Null makes the build reject the flag, as older ones do. */
  version?: string | null;
  /**
   * What `harnesstrim capabilities` prints. Defaults to a declaration that agrees with the
   * manifest; null makes the build reject the unknown option, as builds before `0.0.7` do.
   */
  capabilities?: string | null;
}

/**
 * The minimal machine-readable declaration that agrees with the manifest.
 *
 * The same shape upstream publishes — one entry per harness with surfaces, narrowing flags and a
 * write set — with only the anchors this adapter compares against. The authoritative snapshot is
 * the committed fixture; this is the agreement case the drift tests mutate from.
 */
function defaultCapabilities(): string {
  return JSON.stringify({
    version: '0.1.0',
    harnesses: {
      claude: {
        adapter: '@harnesstrim/adapter-claude',
        surfaces: ['PostToolUse Bash hook — deterministic reduction of Bash output'],
        narrowing: [],
        writeSet: [
          '.claude/skills/',
          '.claude/settings.json',
          'CLAUDE.md (marker-guarded snippet)',
        ],
      },
      codex: {
        adapter: '@harnesstrim/adapter-codex',
        surfaces: ['PostToolUse Bash hook — deterministic reduction of Bash output'],
        narrowing: [],
        writeSet: ['.codex/skills/'],
      },
      opencode: {
        adapter: '@harnesstrim/adapter-opencode',
        surfaces: ['tool.execute.after — slims noisy tool output in place'],
        narrowing: [],
        writeSet: ['.opencode/plugin/harnesstrim.ts'],
      },
      hermes: {
        adapter: '@harnesstrim/adapter-hermes',
        surfaces: ['transform_tool_result — deterministic reduction'],
        narrowing: [],
        writeSet: ['.hermes/plugins/harnesstrim/'],
      },
      pi: {
        adapter: '@harnesstrim/adapter-pi',
        surfaces: ['tool_result — deterministic reduction'],
        narrowing: [],
        writeSet: ['.pi/extensions/harnesstrim/'],
      },
    },
  });
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
        const asksCapabilities = request.args[0] === 'capabilities';
        // `version: null` models the older build, which rejects the unknown option with a non-zero
        // exit — a different thing from not being installed, and the distinction the probe exists
        // to draw.
        const declared = options.version === undefined ? '0.0.5' : options.version;
        const rejects = asksVersion && declared === null;
        const capabilitiesAnswer =
          options.capabilities === undefined ? defaultCapabilities() : options.capabilities;
        const capabilitiesRejects = asksCapabilities && capabilitiesAnswer === null;
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
          executablePath: options.runnable === false ? null : `${HOME}\\pnpm\\harnesstrim.CMD`,
          exitCode: options.runnable === false ? null : rejects || capabilitiesRejects ? 1 : 0,
          signal: null,
          stdout:
            options.runnable === false
              ? ''
              : asksVersion
                ? (declared ?? '')
                : asksCapabilities
                  ? (capabilitiesAnswer ?? '')
                  : 'harnesstrim — one token policy',
          stderr: rejects
            ? "Unknown option '--version'"
            : capabilitiesRejects
              ? "Unknown option 'capabilities'"
              : '',
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

  it('recognises the plugin module the OpenCode installer writes', () => {
    // The only form HarnessTrim takes on OpenCode. Its installer says why: "OpenCode's `plugin`
    // config can't pass options, so the adapter is installed as a local plugin file instead."
    // Spike 9.1 taught the OpenCode adapter to read those directories, so the path now arrives at
    // the seam — and before this, no provider claimed it, leaving a real installation invisible to
    // adoption, to `verify`, and to the conflict detector.
    assert.deepEqual(
      harnessesWiredToHarnessTrim([
        wired('opencode', 'C:\\work\\demo\\.opencode\\plugin\\harnesstrim.ts'),
      ]),
      ['opencode'],
    );
    assert.deepEqual(
      harnessesWiredToHarnessTrim([wired('opencode', './.opencode/plugin/harnesstrim.ts')]),
      ['opencode'],
    );
  });

  it('does not claim a rival plugin module, or a directory of its own name', () => {
    // RTK's module is the neighbour in the same directories, and it is not this provider's.
    assert.deepEqual(
      harnessesWiredToHarnessTrim([wired('opencode', '/home/dev/.config/opencode/plugins/rtk.ts')]),
      [],
    );
    // Anchored at the file, so a path merely containing a `harnesstrim` directory is not an
    // installation — otherwise every module under `.harnesstrim/` would claim to be one.
    assert.deepEqual(
      harnessesWiredToHarnessTrim([wired('opencode', '/home/dev/harnesstrim/plugin/other.ts')]),
      [],
    );
  });
});

/** A mutable parse of the agreement declaration, for the drift tests to mutate from. */
function parsedCapabilities(): HarnessTrimCapabilities {
  return JSON.parse(defaultCapabilities()) as HarnessTrimCapabilities;
}

describe('the machine-readable capability declaration (item 43a)', () => {
  it('reads it at detection and reports no drift when it agrees with the manifest', async () => {
    const detection = await harnesstrimAdapter.detect(context());
    assert.equal(
      detection.warnings.some((warning) => warning.code === 'provider-capabilities-drift'),
      false,
    );
    assert.match(
      detection.evidence.map((entry) => entry.detail).join(' '),
      /declared 0\.1\.0 for claude, codex, opencode, hermes, pi/,
    );
  });

  it('keeps the manifest declaration, and stays quiet, when the build cannot answer', async () => {
    // A build before the `capabilities` command exists rejects the unknown option, exactly as it
    // rejects `--version`. The manifest is the only source for that build, which is what "a
    // provider that cannot be asked must still be describable" means.
    const detection = await harnesstrimAdapter.detect(context({ capabilities: null }));
    assert.equal(detection.state, 'installed');
    assert.equal(
      detection.warnings.some((warning) => warning.code === 'provider-capabilities-drift'),
      false,
    );
  });

  it('reports a harness the manifest declares and the answer omits, naming both sides', async () => {
    const capabilities = parsedCapabilities() as {
      version: string;
      harnesses: Record<string, HarnessTrimHarnessCapabilities>;
    };
    delete capabilities.harnesses['opencode'];
    const warnings = compareCapabilities(harnesstrimAdapter.manifest, capabilities);
    assert.equal(warnings.length, 1);
    const warning = warnings[0];
    assert.ok(warning);
    assert.match(warning.message, /manifest declares tool\.output\.reduce on opencode/);
    assert.match(warning.message, /capabilities.* lists no opencode entry/);
  });

  it('reports a surface disagreement, naming the declared anchor and the reported list', async () => {
    const capabilities = parsedCapabilities();
    const claude = capabilities.harnesses['claude'];
    assert.ok(claude);
    claude.surfaces = ['CLAUDE.md reduce-pipe instruction — the effective reduction path'];
    const warnings = compareCapabilities(harnesstrimAdapter.manifest, capabilities);
    assert.equal(warnings.length, 1);
    const warning = warnings[0];
    assert.ok(warning);
    assert.match(warning.message, /Bash\/post-tool-use/);
    assert.match(warning.message, /CLAUDE\.md reduce-pipe instruction/);
    assert.match(warning.message, /0\.1\.0/);
  });

  it('reports a reviewed path the write set no longer covers', async () => {
    const capabilities = parsedCapabilities();
    const claude = capabilities.harnesses['claude'];
    assert.ok(claude);
    claude.writeSet = [
      '.claude/other/',
      '.claude/settings.json',
      'CLAUDE.md (marker-guarded snippet)',
    ];
    const warnings = compareCapabilities(harnesstrimAdapter.manifest, capabilities);
    const warning = warnings.find((entry) => /reviewed claude write set/.test(entry.message));
    assert.ok(warning);
    assert.match(warning.message, /\.claude\/skills\/compact-handoff\/SKILL\.md/);
    assert.match(
      warning.message,
      /declares nothing covering it \(\.claude\/other\/, \.claude\/settings\.json, CLAUDE\.md\)/,
    );
  });

  it('reports a declared write-set path outside the containment boundary', async () => {
    const capabilities = parsedCapabilities();
    const claude = capabilities.harnesses['claude'];
    assert.ok(claude);
    claude.writeSet = [
      '.claude/skills/',
      '.claude/settings.json',
      'CLAUDE.md (marker-guarded snippet)',
      '.codex/skills/',
    ];
    const warnings = compareCapabilities(harnesstrimAdapter.manifest, capabilities);
    const warning = warnings.find((entry) => /containment boundary/.test(entry.message));
    assert.ok(warning);
    assert.match(warning.message, /\.codex\/skills\//);
    assert.match(warning.message, /recorded at 0\.0\.7 \(\.claude, CLAUDE\.md\)/);
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

  it('reads both the project and Hermes home metrics locations', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({
        files: {
          [METRICS]: `${trimEvent()}\n`,
          // Hermes telemetry is a user-home source admitted only because the Hermes adapter is registered.
          [HERMES_METRICS]: `${trimEvent({ harness: 'hermes' })}\n`,
        },
      }),
      target,
    );
    assert.equal(result.imported, 2);
    assert.deepEqual(
      target.events.map((event) => event.context.harnessId),
      ['claude', 'hermes'],
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

describe('native events (PLAN §15 item 43d)', () => {
  it('uses the producer event id as the identity', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${nativeTrimEvent()}\n` } }),
      target,
    );
    assert.equal(result.mode, 'native-with-residue');
    const event = target.events[0];
    assert.ok(event);
    // The identity is the producer's, everywhere an identity appears: the dedup id, the native
    // reference, and the operation id are the same string, and none of them is synthesized.
    assert.equal(event.eventId, '3f8c9a91-7c2d-4a1e-9f6b-5d4e8c2a1b00');
    assert.equal(event.source.nativeEventId, '3f8c9a91-7c2d-4a1e-9f6b-5d4e8c2a1b00');
    assert.equal(event.context.operationId, '3f8c9a91-7c2d-4a1e-9f6b-5d4e8c2a1b00');
  });

  it('maps a real token count as exact-local', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({
        files: { [METRICS]: `${nativeTrimEvent({ beforeTokens: 320, afterTokens: 31 })}\n` },
      }),
      target,
    );
    const event = target.events[0];
    assert.ok(event);
    // "A token count is a token count where one exists": the producer's figures are used as
    // they are, which is what makes the class exact rather than estimated.
    assert.equal(event.measurement.class, 'exact-local');
    assert.equal(event.measurement.beforeTokens, 320);
    assert.equal(event.measurement.afterTokens, 31);
  });

  it('stays estimated-local for a native char event on a harness that cannot dryrun', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({
        files: {
          // A codex event: the fixture's adapter list gives that harness no `--mode` flag, so a
          // char-only native line from it can only describe an applied reduction.
          [METRICS]: `${nativeTrimEvent({ harness: 'codex' })}\n`,
        },
      }),
      target,
    );
    const event = target.events[0];
    assert.ok(event);
    // No tokenizer here, so the class is the character estimate — exactly as for a legacy line.
    assert.equal(event.measurement.class, 'estimated-local');
    assert.equal(event.measurement.beforeTokens, null);
    assert.equal(event.measurement.afterTokens, null);
    // And, being provably applied, it is not flagged as an unresolved mode.
    assert.equal(event.outcome.bypassReason, null);
    // With nothing unresolved, the native mode needs no residue qualification.
    assert.equal(result.mode, 'native');
  });

  for (const harness of ['opencode', 'hermes', 'pi', 'omp']) {
    it(`files a char-only native ${harness} event as counterfactual, not estimated`, async () => {
      const target = store();
      const result = await harnesstrimAdapter.collectMetrics(
        context({ files: { [METRICS]: `${nativeTrimEvent({ harness })}\n` } }),
        target,
      );
      const event = target.events[0];
      assert.ok(event);
      // This is the regression PLAN §15 item 43d must not reintroduce: the schema 1 envelope no
      // longer carries `mode`, and every mode-carrying adapter records a dryrun identically to
      // its active one — OpenCode emits the reduced line unchanged, Hermes writes its metric
      // before the dryrun return, Pi and OMP write "a receipt with the would-be counts" — so a
      // char-only native line from them can never be proven realized. It is counterfactual —
      // excluded from every realized total — and only the residual is reported, once.
      assert.equal(event.measurement.class, 'counterfactual');
      assert.equal(event.outcome.changed, false);
      assert.equal(event.outcome.bypassReason, 'mode-unresolved');
      // The stream is natively read, but a part of it could not be classed as realized.
      assert.equal(result.mode, 'native-with-residue');
      const unresolved = result.diagnostics.find(
        (entry) => entry.code === 'provider-metrics-mode-unresolved',
      );
      assert.ok(unresolved);
      assert.equal(unresolved.severity, 'info');
      assert.match(unresolved.message, /1 native event from a mode-carrying harness/);
    });
  }

  it('reports the unresolved-mode count once per import, not once per event', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({
        files: { [METRICS]: `${nativeTrimEvent()}\n${nativeTrimEvent({}, 'id-2')}\n` },
      }),
      target,
    );
    assert.equal(target.events.length, 2);
    // The mode plainly states the residue rather than a bare `native`.
    assert.equal(result.mode, 'native-with-residue');
    // One aggregated line for the whole import — the 78-character budget and a thousand-line
    // file make a per-event diagnostic the failure mode line-width.test.ts exists to catch.
    assert.equal(
      result.diagnostics.filter((entry) => entry.code === 'provider-metrics-mode-unresolved')
        .length,
      1,
    );
    const unresolved = result.diagnostics.find(
      (entry) => entry.code === 'provider-metrics-mode-unresolved',
    );
    assert.match(unresolved?.message ?? '', /2 native events from a mode-carrying harness/);
  });

  it('leaves a token-counting native event exact even on opencode', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({
        files: { [METRICS]: `${nativeTrimEvent({ beforeTokens: 320, afterTokens: 31 })}\n` },
      }),
      target,
    );
    const event = target.events[0];
    assert.ok(event);
    // A token count reaches the line from a reduce-pipe or MCP run, which is a separate process
    // and cannot be dryrun; it is exact.
    assert.equal(event.measurement.class, 'exact-local');
    assert.equal(event.outcome.changed, true);
    // Everything was classed, so there is no residue to qualify the native mode.
    assert.equal(result.mode, 'native');
  });

  it('files a recorded pass-through as a bypass, not as a saving', async () => {
    const target = store();
    await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${nativeTrimEvent({ changed: false })}\n` } }),
      target,
    );
    const event = target.events[0];
    assert.ok(event);
    // `changed: false` is the producer's pass-through mark: the reducer ran in active mode and
    // changed nothing. It is not a dryrun — the attempt happened — so the class stays a measured
    // one, and the figure is no saving of any sign.
    assert.equal(event.outcome.changed, false);
    assert.equal(event.outcome.bypassReason, 'pass-through');
    assert.equal(event.measurement.class, 'estimated-local');
  });

  it('keeps legacy lines on the synthesized identity in a mixed stream', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${trimEvent()}\n${nativeTrimEvent()}\n` } }),
      target,
    );
    // The stream is natively read, but its OpenCode line cannot prove a realized reduction.
    assert.equal(result.mode, 'native-with-residue');
    assert.equal(target.events.length, 2);
    const [legacy, native] = target.events;
    assert.ok(legacy && native);
    // The two shapes keep their own identities and their own classes: the legacy line is still
    // synthesized and estimated, the native line is not, and nothing merges them.
    assert.equal(legacy.source.nativeEventId, null);
    assert.equal(legacy.measurement.class, 'estimated-local');
    assert.equal(native.source.nativeEventId, '3f8c9a91-7c2d-4a1e-9f6b-5d4e8c2a1b00');
    assert.notEqual(legacy.eventId, native.eventId);
  });

  it('keeps the identity when the file is rewritten with the same events', async () => {
    const first = store();
    await harnesstrimAdapter.collectMetrics(
      context({
        files: {
          [METRICS]: `${nativeTrimEvent()}\n${nativeTrimEvent({}, 'id-2')}\n`,
        },
      }),
      first,
    );
    // Same events, reversed order — a different file, the same identities. This is what the
    // synthesized identity cannot do: its digest of source, ordinal, and line changes with the
    // ordinal, so a rewritten file would look like new events.
    const second = store();
    await harnesstrimAdapter.collectMetrics(
      context({
        files: {
          [METRICS]: `${nativeTrimEvent({}, 'id-2')}\n${nativeTrimEvent()}\n`,
        },
      }),
      second,
    );
    // Order follows the file, not the identity, so the two runs sort to the same id set.
    assert.deepEqual(
      first.events.map((event) => event.eventId).sort(),
      second.events.map((event) => event.eventId).sort(),
    );
  });

  it('skips a schema this build does not understand', async () => {
    const target = store();
    const future = JSON.parse(nativeTrimEvent()) as Record<string, unknown>;
    future['schemaVersion'] = 2;
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${nativeTrimEvent()}\n${JSON.stringify(future)}\n` } }),
      target,
    );
    // RFC 0006 rule 1 at the line: a shape this build does not understand is skipped, and the
    // existing rows-skipped warning already says to check whether upstream changed its schema.
    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 1);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'provider-metrics-rows-skipped'),
      true,
    );
  });

  it('skips a native line without its identity rather than synthesizing one', async () => {
    const target = store();
    const result = await harnesstrimAdapter.collectMetrics(
      context({ files: { [METRICS]: `${nativeTrimEvent({ eventId: '' })}\n` } }),
      target,
    );
    // A schema 1 line is not an older file, so it does not get the legacy fallback; an identity
    // that cannot dedup is skipped, loudly enough for the warning.
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 1);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'provider-metrics-rows-skipped'),
      true,
    );
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

/**
 * HarnessTrim — PLAN §11 and RFC 0005 §Importers §HarnessTrim.
 *
 * HarnessTrim 0.0.7 can install Claude skills without either the Bash hook or the
 * reduce-pipe instruction. That is a non-intercepting integration, so it composes with RTK:
 * the resolver retains RTK as sole owner of `shell.output.reduce`, while this adapter delegates
 * only `harnesstrim install claude --apply --no-hook --no-instructions`.
 */

import {
  MANIFEST_SCHEMA_VERSION,
  OPTIMIZATION_EVENT_SCHEMA_VERSION,
  classifyVersion,
  diagnostic,
  digestText,
  evidence,
  harnessId,
  providerId,
  type Diagnostic,
  type Evidence,
  type HarnessId,
  type ImportCursor,
  type MetricsStore,
  type OptimizationEvent,
  type ProviderDetection,
  type DelegatedProviderInstallAction,
  type ProviderManifest,
  type ProviderPlan,
  type ProviderState,
  type RemoveOwnedChangeAction,
  type VerificationCheck,
} from '@token-harness/core';
import type {
  MetricsImport,
  PassiveReceipt,
  ProviderAdapter,
  ProviderContext,
  ProviderPlanRequest,
  ProviderVerification,
} from './contract.js';

const HARNESSTRIM = providerId('harnesstrim');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

const CLAUDE_ARTIFACT_DIGESTS: Readonly<Record<string, string>> = {
  'compact-handoff/SKILL.md':
    'sha256:0efbf35581c559359e755b204778b64a289dab4d20dadc1cba3d5b5c995b5f01',
  'debug-log-slim/SKILL.md':
    'sha256:17f5ccc34d29d7aba083444e0e4d87fd3d49916ebcb4e6544caf8c89f13f0045',
  'delegate-bulk/SKILL.md':
    'sha256:3753de2ad18271c24832e4cda63115d353620515d5d80f40e93bc07d2a7257d7',
  'delta-response/SKILL.md':
    'sha256:b6a71f4bdcfcadde3b5242994baa017d0371fe11652dd763f55a2f6d3840cfa8',
  'delta-response/references/examples.md':
    'sha256:c67a1f57e63550b396043c3072b7e1a3a0c1522376471f53d6829253339e64e7',
  'review-delta/SKILL.md':
    'sha256:4dfbf9d6ec08dff27b4759726536b43928370e288706fa01f5b498648e741388',
  'scaffold-fast/SKILL.md':
    'sha256:1a18d52c4d335fbd3f74e2559bc20d6346193a40eef7b85149f51f44f697d182',
};
const OPENCODE = harnessId('opencode');

/** Recognises HarnessTrim's own invocation, including the Windows batch shim. */
const HOOK_COMMAND_PATTERN = /(^|[\\/\s"'])harnesstrim(\.cmd|\.exe)?([\s"']|$)/i;

/**
 * The surfaces HarnessTrim reduces on, from the source references RFC 0003 cites.
 *
 * Claude and Codex are `Bash` only; OpenCode is every tool result, which is why its surface is the
 * wildcard. Recording the difference is what lets the resolver see that the overlap with RTK is
 * exact on two harnesses and a strict superset on the third — the finding RFC 0003 turns on.
 */
const MANIFEST: ProviderManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: HARNESSTRIM,
  displayName: 'HarnessTrim',
  description: 'Deterministic output reducers, harness adapters, skills, and an MCP reduce tool.',
  homepage: 'https://github.com/giuliastro/HarnessTrim',
  sourceRepository: 'https://github.com/giuliastro/HarnessTrim',
  license: { spdx: null, distributionMode: 'external', reviewRequired: false },
  capabilities: [
    {
      capability: 'shell.output.reduce',
      mode: 'exclusive',
      harnesses: [CLAUDE, CODEX],
      // `HOOK_MATCHER = "Bash"` and `CODEX_HOOK_MATCHER = "^Bash$"`, per RFC 0003 §The table is an
      // intent. One surface each, and no selector narrows it.
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'post-tool-use' }],
      evidence: {
        sourceReference: 'docs/rfcs/0003-capabilities-and-conflicts.md#the-table-is-an-intent',
        upstreamVersion: '0.0.5',
      },
    },
    {
      capability: 'tool.output.reduce',
      mode: 'exclusive',
      harnesses: [OPENCODE],
      // `tool.execute.after` reduces `output.output` with `input.tool` never used as a filter, so
      // the claim is every family the harness exposes rather than a named one.
      surfaces: [{ toolFamily: '*', interceptionPoint: 'tool-execute-after' }],
      evidence: {
        sourceReference: 'docs/rfcs/0003-capabilities-and-conflicts.md#the-table-is-an-intent',
        upstreamVersion: '0.0.5',
      },
    },
  ],
  platforms: [
    { os: 'windows', wsl: false, supported: true, limitation: null },
    { os: 'windows', wsl: true, supported: true, limitation: null },
    { os: 'macos', wsl: false, supported: true, limitation: null },
    { os: 'linux', wsl: false, supported: true, limitation: null },
  ],
  harnesses: [
    {
      harness: CLAUDE,
      testedVersions: { minimum: '2.0.0', maximum: '2.1.212' },
      verificationTier: 'config-only',
    },
    {
      harness: CODEX,
      testedVersions: { minimum: '0.146.0', maximum: '0.146.0' },
      verificationTier: 'config-only',
    },
    {
      harness: OPENCODE,
      testedVersions: { minimum: '1.18.9', maximum: '1.18.9' },
      verificationTier: 'config-only',
    },
  ],
  /**
   * Declared for completeness and never used under `safe`.
   *
   * RFC 0003 §Resolution at 0.1.0 permits `custom` to assign `shell.output.reduce` to HarnessTrim
   * instead of RTK, because *that* state is producible — it is the installer's own default. The
   * channel is recorded so such a plan has somewhere to come from; `safe` never reaches it.
   */
  installationChannels: [
    {
      id: 'pnpm',
      kind: 'npm',
      priority: 0,
      platforms: ['windows', 'macos', 'linux'],
      requiresNetwork: true,
      requiresElevation: false,
      digestAvailable: false,
    },
  ],
  metrics: {
    // RFC 0005 §Importer degradation policy: `legacy` is the character-only `TrimEvent` JSONL, and
    // it is "a supported steady state, not a warning". `native` would need upstream to expose token
    // counts and native ids, which `0.0.5` does not.
    source: 'jsonl',
    mode: 'legacy',
    locations: ['.harnesstrim/metrics.jsonl', '~/.hermes/harnesstrim-metrics.jsonl'],
  },
  delegatedInstallReview: {
    upstreamVersion: '0.0.7',
    reviewedWriteSet: [
      ...Object.keys(CLAUDE_ARTIFACT_DIGESTS).map((path) => `.claude/skills/${path}`),
    ],
    containmentBoundary: ['.claude', 'CLAUDE.md'],
    upstreamUninstallAvailable: true,
  },
};

/**
 * The reviewed release that supports the safe Claude skills-only invocation.
 */
const TESTED_UPSTREAM = '0.0.7';
const TESTED_VERSIONS = { minimum: '0.0.5', maximum: TESTED_UPSTREAM };

function identifiesCommand(command: string): boolean {
  return HOOK_COMMAND_PATTERN.test(command);
}

/** Harnesses whose configuration names HarnessTrim in a hook command. */
export function harnessesWiredToHarnessTrim(
  configs: readonly ProviderContext['harnessConfigs'][number][],
): HarnessId[] {
  const wired = new Set<HarnessId>();
  for (const config of configs) {
    if (config.commands.some((command) => identifiesCommand(command))) wired.add(config.harnessId);
  }
  return [...wired];
}

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

/**
 * Runs the tool and reports what it says about itself.
 *
 * `--version` first, because a build that has it should be believed. A build that does not rejects
 * it as an unknown option and exits non-zero, so `--help` follows — which separates "is here and
 * cannot tell me its version" from "is not here at all", two states RFC 0002 §Detection keeps apart.
 */
async function probeExecutable(context: ProviderContext): Promise<{
  installed: boolean;
  version: string | null;
  path: string | null;
  evidence: Evidence[];
}> {
  const asked = await context.runner.run({
    executable: 'harnesstrim',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });

  // Could not be started at all, which is a different finding from an unknown flag.
  if (asked.failure !== null) {
    return {
      installed: false,
      version: null,
      path: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: 'harnesstrim',
          detail: `not runnable: ${asked.failure.reason}`,
        }),
      ],
    };
  }

  if (asked.exitCode === 0) {
    const version = VERSION_PATTERN.exec(asked.stdout)?.[1] ?? null;
    return {
      installed: true,
      version,
      path: asked.executablePath,
      evidence: [
        evidence({
          kind: 'version-output',
          source: 'harnesstrim --version',
          path: asked.executablePath,
          detail: version === null ? 'reported no recognisable version' : `reported ${version}`,
        }),
      ],
    };
  }

  /**
   * Non-zero from `--version` is how the older build rejects an unknown option, so this asks a
   * question it is certain to understand. It is still installed, and saying so with the reason is
   * better than reporting it absent because one flag was not recognised.
   */
  const help = await context.runner.run({
    executable: 'harnesstrim',
    args: ['--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });

  if (help.failure !== null || help.exitCode !== 0) {
    return {
      installed: false,
      version: null,
      path: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: 'harnesstrim',
          detail: 'neither --version nor --help succeeded',
        }),
      ],
    };
  }

  return {
    installed: true,
    version: null,
    path: help.executablePath,
    evidence: [
      evidence({
        kind: 'version-output',
        source: 'harnesstrim --help',
        path: help.executablePath,
        detail: 'runs, but this build rejects --version, so no version could be recorded',
      }),
    ],
  };
}

/** The metrics files this provider might have written, in RFC 0005's declared order. */
export function metricsLocations(context: ProviderContext): string[] {
  return [
    context.fs.join(context.projectRoot, '.harnesstrim', 'metrics.jsonl'),
    context.fs.join(context.paths.home, '.hermes', 'harnesstrim-metrics.jsonl'),
  ];
}

async function detect(context: ProviderContext): Promise<ProviderDetection> {
  const probe = await probeExecutable(context);
  const configured = harnessesWiredToHarnessTrim(context.harnessConfigs);
  const warnings: Diagnostic[] = [];
  const evidenceItems: Evidence[] = [...probe.evidence];

  for (const harness of configured) {
    evidenceItems.push(
      evidence({
        kind: 'config-entry',
        source: `${harness} hook`,
        path:
          context.harnessConfigs.find((config) => config.harnessId === harness)?.configPath ?? null,
        detail: 'names harnesstrim in a hook command',
      }),
    );
  }

  // RFC 0002 §Detection: a configuration string alone never establishes presence. A harness wired
  // to harnesstrim with no runnable harnesstrim is `broken` — present and unable to work.
  const state: ProviderState = !probe.installed
    ? configured.length > 0
      ? 'broken'
      : 'absent'
    : configured.length > 0
      ? 'configured'
      : 'installed';

  if (state === 'broken') {
    warnings.push(
      diagnostic({
        severity: 'error',
        code: 'provider-configured-but-missing',
        message:
          'A harness hook on this machine invokes harnesstrim, but harnesstrim could not be run, so every intercepted operation will fail',
        path: context.harnessConfigs[0]?.configPath ?? null,
        remediation: 'Install HarnessTrim, or remove the hook entry that invokes it',
      }),
    );
  }

  return {
    providerId: HARNESSTRIM,
    version: probe.version,
    state,
    executable: probe.path,
    installationChannel: null,
    // A verdict only when there is a version to judge. Null otherwise: an unreadable version is not
    // an out-of-range one, and treating it as one would exit 3 on every machine running a build that
    // cannot answer.
    versionVerdict: probe.version === null ? null : classifyVersion(probe.version, TESTED_VERSIONS),
    configuredHarnesses: configured,
    unmanagedHarnessesConfigured: configured.filter(
      (harness) => !MANIFEST.harnesses.some((entry) => entry.harness === harness),
    ),
    // RFC 0002 §Providers may exceed the managed surface: HarnessTrim ships adapters for Hermes and
    // Pi as well, which Token Harness does not manage, so a wired one is reported and left alone.
    supportsUnmanagedHarnesses: true,
    // RFC 0004 §Brownfield adoption, and for this provider it is structural rather than
    // circumstantial: PLAN §11 says Token Harness never installs it, so every installation it ever
    // sees is the user's.
    managedByTokenHarness: false,
    evidence: evidenceItems,
    warnings,
  };
}

/**
 * One `TrimEvent`, as RFC 0005 §Importers §HarnessTrim records the on-disk shape at `0.0.5`.
 *
 * `mode` is not in that list and is read when present: the OpenCode adapter emits events in
 * `dryrun` as well as `active`, and RFC 0005 §A measured reduction is not always a realized one
 * makes the difference decide the measurement class. Absent, the event is treated as active,
 * because the two harnesses that omit it have no dryrun path.
 */
interface TrimEvent {
  ts: string;
  harness: string;
  tool: string;
  reducer: string | null;
  beforeChars: number;
  afterChars: number;
  mode?: string;
}

function parseTrimEvent(line: string): TrimEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const ts = record['ts'];
  const harness = record['harness'];
  const before = record['beforeChars'];
  const after = record['afterChars'];
  if (
    typeof ts !== 'string' ||
    typeof harness !== 'string' ||
    typeof before !== 'number' ||
    typeof after !== 'number'
  ) {
    return null;
  }
  return {
    ts,
    harness,
    tool: typeof record['tool'] === 'string' ? record['tool'] : '',
    reducer: typeof record['reducer'] === 'string' ? record['reducer'] : null,
    beforeChars: before,
    afterChars: after,
    ...(typeof record['mode'] === 'string' ? { mode: record['mode'] } : {}),
  };
}

/**
 * The synthesized identity RFC 0005 requires of a stream with no native event id.
 *
 * "a hash of the source identity, the line ordinal, and the line content". All three, because none
 * alone is enough: two identical lines can be two real events, the same ordinal in two files is two
 * events, and `ts` "is not unique under concurrency".
 */
export function synthesizeEventId(sourceId: string, ordinal: number, line: string): string {
  const digest = digestText(`${sourceId} ${String(ordinal)} ${line}`);
  return `harnesstrim-${digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 17)}`;
}

/**
 * A `TrimEvent` becomes a normalized event, per RFC 0005's mapping table.
 *
 * The two rules that carry the weight: tokens stay `null` because `0.0.5` records characters and
 * "never derived silently", and a `dryrun` event is `counterfactual` with `changed: false` because
 * "the bytes stayed in context, and the figure describes a saving that did *not* occur".
 */
function toEvent(
  event: TrimEvent,
  sourceId: string,
  ordinal: number,
  line: string,
  context: ProviderContext,
): OptimizationEvent | null {
  const instant = new Date(event.ts);
  if (Number.isNaN(instant.getTime())) return null;

  const dryrun = event.mode === 'dryrun';
  const eventId = synthesizeEventId(sourceId, ordinal, line);

  return {
    schemaVersion: OPTIMIZATION_EVENT_SCHEMA_VERSION,
    eventId,
    timestamp: instant.toISOString(),
    provider: { id: HARNESSTRIM, version: null },
    context: {
      // The project the metrics file belongs to, which for the default location is the project it
      // sits inside.
      projectId: context.projectIdFor(context.projectRoot),
      // Unlike RTK's database, a `TrimEvent` names its harness, so this is read rather than left
      // unknown.
      harnessId: event.harness,
      sessionId: null,
      operationId: eventId,
      pipelineId: null,
      pipelineOrder: null,
      toolFamily: event.tool === '' ? null : event.tool,
      capability: event.harness === OPENCODE ? 'tool.output.reduce' : 'shell.output.reduce',
    },
    measurement: {
      class: dryrun ? 'counterfactual' : 'estimated-local',
      beforeChars: event.beforeChars,
      afterChars: event.afterChars,
      // RFC 0005: "never derived silently". `0.0.5` counts characters and nothing else.
      beforeTokens: null,
      afterTokens: null,
      tokenizer: null,
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      // A dryrun leaves `output.output` untouched, so nothing the model saw changed.
      changed: !dryrun && event.afterChars !== event.beforeChars,
      bypassReason: dryrun
        ? 'dryrun'
        : event.afterChars === event.beforeChars
          ? 'no-reduction-applied'
          : null,
      originalReference: null,
      latencyMs: null,
      errorCode: null,
    },
    source: { nativeEventId: null, importedAt: context.now() },
  };
}

async function verify(context: ProviderContext): Promise<ProviderVerification> {
  const checks: VerificationCheck[] = [];
  const diagnostics: Diagnostic[] = [];

  const probe = await probeExecutable(context);
  checks.push({
    id: 'executable-resolves',
    status: probe.installed ? 'pass' : 'fail',
    summary: !probe.installed
      ? 'harnesstrim could not be run'
      : probe.version === null
        ? 'harnesstrim runs, but this build cannot report a version'
        : `harnesstrim ${probe.version}`,
    achievedTier: probe.installed ? 'presence' : null,
    evidence: probe.evidence,
    remediation: probe.installed ? null : 'Install HarnessTrim, or add it to PATH',
  });

  const configured = harnessesWiredToHarnessTrim(context.harnessConfigs);
  checks.push({
    id: 'hook-registered',
    status: configured.length > 0 ? 'pass' : 'not-exercised',
    summary:
      configured.length > 0
        ? `wired to ${configured.join(', ')}`
        : 'no harness configuration names harnesstrim',
    achievedTier: configured.length > 0 ? 'config-only' : null,
    evidence: [],
    remediation: null,
  });

  /**
   * The receipt, if telemetry was ever enabled.
   *
   * RFC 0007 §Active and passive canaries: this is the passive form, reading a record the provider
   * already wrote. `--metrics` is opt-in, so its absence is `not-exercised` rather than a failure —
   * nothing is wrong, nothing has been recorded.
   */
  let receipt: PassiveReceipt | null = null;
  for (const path of metricsLocations(context)) {
    const stat = await context.fs.stat(path);
    if (stat === null || stat.byteLength === 0) continue;
    const text = new TextDecoder().decode(await context.fs.readFile(path));
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const last = lines.at(-1);
    const parsed = last === undefined ? null : parseTrimEvent(last);
    if (parsed === null) continue;
    receipt = { observedAt: parsed.ts, operations: lines.length, source: path };
    break;
  }

  checks.push({
    id: 'canary-intercepted',
    status: receipt === null ? 'not-exercised' : 'pass',
    summary:
      receipt === null
        ? 'no telemetry file yet, so nothing has been observed'
        : `${String(receipt.operations)} reductions recorded, most recently ${receipt.observedAt}`,
    // A recorded reduction is the provider witnessing its own interception, which is what `canary`
    // means in RFC 0007's tier table.
    achievedTier: receipt === null ? null : 'canary',
    evidence: [],
    remediation:
      receipt === null ? 'Pass `--metrics <path>` on the hook command to record telemetry' : null,
  });

  // RFC 0003 §The instruction-level path: guidance in AGENTS.md is a second shell-reduction path
  // that hook ownership does not cover, and `verify` "checks which instruction text is actually
  // present".
  const agents = context.fs.join(context.projectRoot, 'AGENTS.md');
  if ((await context.fs.stat(agents)) !== null) {
    const text = new TextDecoder().decode(await context.fs.readFile(agents));
    if (identifiesCommand(text)) {
      checks.push({
        id: 'instruction-path-present',
        status: 'info',
        summary: 'AGENTS.md tells the model to reduce output through harnesstrim',
        achievedTier: null,
        evidence: [
          evidence({
            kind: 'config-entry',
            source: 'AGENTS.md',
            path: agents,
            detail: 'names harnesstrim in instruction text',
          }),
        ],
        remediation: null,
      });
    }
  }

  const achievedTier = checks.some((check) => check.achievedTier === 'canary')
    ? 'canary'
    : checks.some((check) => check.achievedTier === 'config-only')
      ? 'config-only'
      : checks.some((check) => check.achievedTier === 'presence')
        ? 'presence'
        : null;

  return {
    providerId: HARNESSTRIM,
    // RFC 0002 §Harness versioning is symmetric: the declared tier is per harness in the manifest,
    // and every entry there is `config-only` because a generated wrapper has no observable receipt.
    declaredTier: 'config-only',
    achievedTier,
    receipt,
    checks,
    diagnostics,
  };
}

/**
 * RFC 0005 §Deduplicating a stream without event IDs, implemented.
 *
 * The file is the ordering authority. The cursor holds a byte offset and the digest of the last
 * imported line; a digest mismatch means the file "was truncated or replaced", so the import
 * restarts from zero and the synthesized identity discards what is already held.
 *
 * This is the source `ImportCursor` was designed for, so unlike RTK's database every file-shaped
 * member is used and `highWaterMark` is null.
 */
async function collectMetrics(
  context: ProviderContext,
  store: MetricsStore,
): Promise<MetricsImport> {
  const diagnostics: Diagnostic[] = [];
  let imported = 0;
  let skipped = 0;
  let lastCursor: ImportCursor | null = null;
  let readAny = false;

  for (const path of metricsLocations(context)) {
    const stat = await context.fs.stat(path);
    if (stat === null) continue;
    readAny = true;

    const text = new TextDecoder().decode(await context.fs.readFile(path));
    const stored = await store.readCursor(HARNESSTRIM, path);

    let from = 0;
    if (stored !== null) {
      // Two ways a stored offset stops being usable, and both mean "start again".
      const shrank = stat.byteLength < stored.byteOffset;
      const priorText = text.slice(0, stored.byteOffset);
      const priorLines = priorText.split('\n').filter((line) => line.trim() !== '');
      const priorLast = priorLines.at(-1);
      const digestMatches =
        stored.lastLineDigest === null ||
        (priorLast !== undefined && digestText(priorLast) === stored.lastLineDigest);

      if (shrank || !digestMatches) {
        diagnostics.push(
          diagnostic({
            severity: 'info',
            code: 'provider-metrics-source-reset',
            message: `${path} was truncated or replaced since the last import, so it is being read from the start`,
            path,
            remediation: null,
          }),
        );
      } else {
        from = stored.byteOffset;
      }
    }

    // Read whole and slice, because the port exposes no positional read. The files RFC 0005
    // describes are one line per reduction, so the cost is proportional to what was reduced rather
    // than to what was saved.
    const fresh = text.slice(from);
    const events: OptimizationEvent[] = [];
    // The ordinal counts from the start of the file, not from the slice: RFC 0005 makes it part of
    // the identity, so a restart has to reproduce the same value for the same line.
    let ordinal =
      fresh === text
        ? 0
        : text
            .slice(0, from)
            .split('\n')
            .filter((l) => l !== '').length;
    let lastLine: string | null = null;

    const lines = fresh.split('\n');
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue;
      const isFinal = index === lines.length - 1;
      const trimmed = line;
      const parsed = parseTrimEvent(trimmed);

      if (parsed === null) {
        // A torn final line is what JSONL tolerates by design: it is not counted as skipped, and
        // the cursor stops before it so the next run reads it whole.
        if (isFinal && !text.endsWith('\n')) break;
        skipped += 1;
        ordinal += 1;
        continue;
      }

      const event = toEvent(parsed, path, ordinal, trimmed, context);
      if (event === null) {
        skipped += 1;
        ordinal += 1;
        continue;
      }
      events.push(event);
      lastLine = trimmed;
      ordinal += 1;
    }

    if (skipped > 0) {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'provider-metrics-rows-skipped',
          message: `${String(skipped)} line${skipped === 1 ? '' : 's'} in ${path} were not in a shape this build understands`,
          path,
          remediation: 'Check whether HarnessTrim changed its TrimEvent schema',
        }),
      );
    }

    // Append before the cursor moves, so a failed write cannot leave the offset past records that
    // were never stored.
    await store.appendEvents(events);
    imported += events.length;

    const consumed = text.endsWith('\n') ? text.length : text.lastIndexOf('\n') + 1;
    const cursor: ImportCursor = {
      providerId: HARNESSTRIM,
      sourceId: path,
      absolutePath: path,
      // RFC 0005 wants device/inode or volume identity here. The port exposes neither, so the size
      // stands in: combined with the last-line digest below it detects the truncation and
      // replacement the identity was there to catch, which is what the rule is for.
      fileIdentity: `bytes:${String(stat.byteLength)}`,
      byteOffset: consumed,
      lastLineDigest: lastLine === null ? (stored?.lastLineDigest ?? null) : digestText(lastLine),
      // Null: this source has no native identifier, which is exactly the case the file-shaped
      // members exist for.
      highWaterMark: null,
      updatedAt: context.now(),
    };
    await store.writeCursor(cursor);
    lastCursor = cursor;
  }

  if (!readAny) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'provider-metrics-unavailable',
        message:
          'HarnessTrim telemetry is opt-in and no metrics file exists, so nothing was imported',
        remediation: 'Pass `--metrics <path>` on the hook command to record it',
      }),
    );
    return {
      providerId: HARNESSTRIM,
      mode: 'unavailable',
      source: null,
      imported: 0,
      skipped: 0,
      cursor: null,
      diagnostics,
    };
  }

  return {
    providerId: HARNESSTRIM,
    // RFC 0005 §Importer degradation policy: character-only events are `legacy`, and "running in
    // legacy mode is a supported steady state, not a warning".
    mode: 'legacy',
    source: `harnesstrim TrimEvent JSONL (${TESTED_UPSTREAM} shape)`,
    imported,
    skipped,
    cursor: lastCursor,
    diagnostics,
  };
}

/**
 * Safe HarnessTrim onboarding is deliberately outside payload ownership: version 0.0.7 can copy
 * Claude skills while skipping both output-reduction paths. The reviewed files are exact, and the
 * executor rejects any hook or instruction change before restoring its snapshot.
 */
async function plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan> {
  const claudeDirectory = context.fs.join(context.projectRoot, '.claude');
  const skillsDirectory = context.fs.join(claudeDirectory, 'skills');
  const expectedArtifacts = Object.entries(CLAUDE_ARTIFACT_DIGESTS).map(([path, digest]) => ({
    path: context.fs.join(skillsDirectory, ...path.split('/')),
    digest,
  }));

  if (!request.harnesses.some((harness) => harness.id === CLAUDE)) {
    return { providerId: HARNESSTRIM, desiredState: request.desiredState, actions: [] };
  }

  if (request.desiredState === 'absent') {
    const actions: RemoveOwnedChangeAction[] = expectedArtifacts.map((artifact) => ({
      kind: 'remove-owned-change',
      id: `harnesstrim-claude-skill-remove-${digestText(artifact.path).slice(7, 15)}`,
      riskClass: 'reversible',
      requiresNetwork: false,
      requiresElevation: false,
      affectedPaths: [artifact.path],
      affectedProcesses: [],
      preconditions: ['the HarnessTrim skill still matches the reviewed 0.0.7 artifact'],
      postconditions: ['the owned HarnessTrim skill is absent'],
      rollbackData: 'file-snapshot',
      explanation: `Remove the owned HarnessTrim Claude skill ${context.fs.basename(context.fs.dirname(artifact.path))}`,
      path: artifact.path,
      reverses: `harnesstrim-claude-skills-${digestText(context.projectRoot).slice(7, 15)}`,
      target: { kind: 'owned-file', path: artifact.path, digest: artifact.digest, mode: null },
    }));
    return { providerId: HARNESSTRIM, desiredState: 'absent', actions };
  }

  const installed = await probeExecutable(context);
  if (installed.version !== TESTED_UPSTREAM) {
    return { providerId: HARNESSTRIM, desiredState: 'configured', actions: [] };
  }
  const review = MANIFEST.delegatedInstallReview;
  if (review === null) throw new Error('HarnessTrim delegated-install review is missing');

  const action: DelegatedProviderInstallAction = {
    kind: 'delegated-provider-install',
    id: `harnesstrim-claude-skills-${digestText(context.projectRoot).slice(7, 15)}`,
    riskClass: 'delegated',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: expectedArtifacts.map((artifact) => artifact.path),
    affectedProcesses: ['harnesstrim'],
    preconditions: [
      'harnesstrim 0.0.7 is installed and on PATH',
      'the reviewed installer writes only the declared Claude skill artifacts',
    ],
    postconditions: [
      'HarnessTrim Claude skills match the reviewed 0.0.7 artifacts',
      'no HarnessTrim hook or reduce-pipe instruction was added',
    ],
    rollbackData: 'directory-snapshot',
    explanation: 'Install HarnessTrim Claude skills without a hook or reduce-pipe instruction',
    executable: 'harnesstrim',
    args: ['install', 'claude', context.projectRoot, '--apply', '--no-hook', '--no-instructions'],
    containmentBoundary: review.containmentBoundary.map((path) =>
      context.fs.join(context.projectRoot, path),
    ),
    expectedArtifacts,
    protectedPaths: [
      context.fs.join(claudeDirectory, 'settings.json'),
      context.fs.join(context.projectRoot, 'CLAUDE.md'),
    ],
    rollbackStrategy: 'restore-snapshot',
    snapshotSizeCapBytes: 1_048_576,
    upstreamUninstallAvailable: review.upstreamUninstallAvailable,
  };
  return { providerId: HARNESSTRIM, desiredState: 'configured', actions: [action] };
}

export const harnesstrimAdapter: ProviderAdapter = {
  manifest: MANIFEST,
  detect,
  identifiesCommand,
  verify,
  collectMetrics,
  plan,
  plansWithoutOwnership: true,
};

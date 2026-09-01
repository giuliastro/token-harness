/**
 * Codex CLI — PLAN §3.2 and RFC 0007's enablement finding.
 *
 * A hook in hooks.json is only a declaration. Codex persists enablement and trust in
 * internal TUI state whose file location was not observable in the spike, so this
 * adapter never converts declaration into activation. `enabled: null` is deliberate.
 */
import {
  classifyVersion,
  diagnostic,
  evidence,
  harnessId,
  MANIFEST_SCHEMA_VERSION,
  type Diagnostic,
  type Evidence,
  type HarnessBudgetObservation,
  type HarnessContextObservation,
  type HarnessDetection,
  type HarnessManifest,
  type JsonValue,
  type VerificationCheck,
  type VersionVerdict,
} from '@token-harness/core';

import { matcherCoversFamily } from './claude.js';
import {
  familiesOnThisPlatform,
  resolveConfigPath,
  type HarnessAdapter,
  type HarnessContext,
  type HarnessInspection,
  type HarnessVerification,
  type ResolvedHarnessConfig,
} from './contract.js';

const CODEX = harnessId('codex');
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;
const MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: CODEX,
  displayName: 'Codex CLI',
  homepage: 'https://developers.openai.com/codex',
  testedVersions: { minimum: '0.146.0', maximum: '0.146.0' },
  verificationTier: 'config-only',
  versionCommand: { executable: 'codex', args: ['--version'] },
  /**
   * Both events, not only the one this machine happened to have configured.
   *
   * The spike found `hooks.json`, `PreToolUse`, `PostToolUse` and `hook_trust` as strings in
   * `codex.exe` 0.146.0, and the live file carried a `PostToolUse` entry. Declaring only the
   * latter made a `PreToolUse` hook invisible: `inspect` would not report it, so conflict
   * detection could not name it as a competing entry on an owned surface, and no provider that
   * intercepts before execution could ever be assigned here.
   *
   * Neither point is evidenced as *firing* — `requiresEnablement` below is what says so — but
   * enumerating a surface the harness has is a different claim from proving it runs.
   */
  interceptionPoints: [
    { scopeId: 'pre-tool-use', eventName: 'PreToolUse' },
    { scopeId: 'post-tool-use', eventName: 'PostToolUse' },
  ],
  configFiles: [
    { path: '.codex/config.toml', scope: 'user', parser: 'toml', primary: true },
    { path: '.codex/hooks.json', scope: 'user', parser: 'json', primary: false },
  ],
  toolFamilies: [
    { id: 'Bash', platforms: ['windows', 'macos', 'linux'], executesShellCommands: true },
  ],
  requiresEnablement: true,
  enablementNote:
    'Codex persists hook enablement and trust separately from hooks.json; the spike could not locate readable state outside the TUI',
  receiptFamily: 'harness-event-stream',
};

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every declared interception point that actually carries entries, with what it carries. */
function readHooks(document: JsonValue): {
  points: string[];
  matchers: string[];
  commands: string[];
} {
  if (!isRecord(document) || !isRecord(document['hooks']))
    return { points: [], matchers: [], commands: [] };
  const hooks = document['hooks'];
  const points: string[] = [];
  const matchers: string[] = [];
  const commands: string[] = [];

  // Driven by the manifest rather than by a literal event name, so adding an interception point
  // above is the whole change; a second list here would be a second place to forget.
  for (const point of MANIFEST.interceptionPoints) {
    const entries = hooks[point.eventName];
    if (!Array.isArray(entries)) continue;
    let carries = false;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (typeof entry['matcher'] === 'string') matchers.push(entry['matcher']);
      if (Array.isArray(entry['hooks'])) {
        for (const hook of entry['hooks']) {
          if (isRecord(hook) && typeof hook['command'] === 'string') {
            commands.push(hook['command']);
            carries = true;
          }
        }
      }
    }
    if (carries) points.push(point.scopeId);
  }

  return {
    points,
    matchers: [...new Set(matchers)],
    commands: [...new Set(commands)],
  };
}

async function resolveConfig(
  declaration: HarnessManifest['configFiles'][number],
  context: HarnessContext,
): Promise<ResolvedHarnessConfig> {
  const path = resolveConfigPath(declaration, context);
  const stat = await context.fs.stat(path);
  if (stat === null || stat.kind !== 'file')
    return {
      declaration,
      path,
      exists: false,
      parsed: false,
      configuredPoints: [],
      matchers: [],
      commands: [],
    };
  const text = new TextDecoder().decode(await context.fs.readFile(path));
  if (declaration.parser === 'toml') {
    // The project-trust TOML is read only here. Writing it awaits a real TOML editor;
    // treating its existence as a hook would conflate separate concerns.
    return {
      declaration,
      path,
      exists: true,
      parsed: true,
      configuredPoints: [],
      matchers: [],
      commands: [],
    };
  }
  try {
    const hooks = readHooks(JSON.parse(text) as JsonValue);
    return {
      declaration,
      path,
      exists: true,
      parsed: true,
      configuredPoints: hooks.points,
      matchers: hooks.matchers,
      commands: hooks.commands,
    };
  } catch {
    return {
      declaration,
      path,
      exists: true,
      parsed: false,
      configuredPoints: [],
      matchers: [],
      commands: [],
    };
  }
}

async function detectVersion(
  context: HarnessContext,
): Promise<{ version: string | null; verdict: VersionVerdict | null; evidence: Evidence[] }> {
  const outcome = await context.runner.run({
    executable: 'codex',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (outcome.failure !== null)
    return {
      version: null,
      verdict: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: 'codex',
          detail: `not runnable: ${outcome.failure.reason}`,
        }),
      ],
    };
  const version = VERSION_PATTERN.exec(outcome.stdout)?.[1] ?? null;
  return {
    version,
    verdict: version === null ? null : classifyVersion(version, MANIFEST.testedVersions),
    evidence: [
      evidence({
        kind: 'version-output',
        source: 'codex',
        path: outcome.executablePath,
        detail:
          version === null ? 'reported no recognisable semantic version' : `reported ${version}`,
      }),
    ],
  };
}

async function detect(context: HarnessContext): Promise<HarnessDetection> {
  const { version, verdict, evidence: versionEvidence } = await detectVersion(context);
  const configs = await Promise.all(
    MANIFEST.configFiles.map((file) => resolveConfig(file, context)),
  );
  const present = configs.filter((config) => config.exists);
  const hooks = configs.find((config) => config.declaration.path.endsWith('hooks.json'));
  const warnings: Diagnostic[] = [];
  if (hooks?.exists && !hooks.parsed)
    warnings.push(
      diagnostic({
        severity: 'error',
        code: 'harness-config-unreadable',
        message: 'This Codex hooks file is not valid JSON, so its hooks cannot be read',
        path: hooks.path,
        remediation: 'Repair the JSON syntax, then run the command again',
      }),
    );
  if (version === null && present.length > 0)
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-executable-missing',
        message:
          'Codex configuration exists but the CLI executable could not be run, so it could not be corroborated',
        path: present[0]?.path ?? null,
        remediation: 'Install Codex CLI or make its executable available on PATH',
      }),
    );
  if (verdict === 'unknown-newer')
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-version-unknown-newer',
        message: `Codex ${String(version)} is newer than the observed hook schema`,
        remediation: 'Check the release notes for hook-schema changes before applying a plan',
      }),
    );
  // `hooks?.configuredPoints.length !== 0` read true when `hooks` was undefined, because
  // `undefined !== 0`. `find` always matches today so it never fired, but it would the moment the
  // manifest stopped declaring `hooks.json` — and it would report an unconfigured harness as
  // configured, which is the direction that misleads.
  const configured = (hooks?.configuredPoints.length ?? 0) > 0;
  const primary =
    configs.find((config) => config.declaration.primary && config.exists) ?? present[0] ?? null;
  return {
    harnessId: CODEX,
    state:
      hooks?.exists && !hooks.parsed
        ? 'broken'
        : configured && version !== null
          ? 'configured'
          : version !== null || present.length > 0
            ? 'detected'
            : 'absent',
    version,
    versionVerdict: verdict,
    configPath: primary?.path ?? null,
    declaredVerificationTier: MANIFEST.verificationTier,
    evidence: [
      ...versionEvidence,
      ...present.map((config) =>
        evidence({
          kind: 'config-entry',
          source: config.declaration.path.endsWith('hooks.json')
            ? 'hooks configuration'
            : 'Codex configuration',
          path: config.path,
          detail: config.parsed
            ? config.configuredPoints.length > 0
              ? `declares ${config.configuredPoints.join(', ')}`
              : 'present with no hook entries'
            : 'present but not valid JSON',
        }),
      ),
    ],
    warnings,
  };
}

async function inspect(context: HarnessContext): Promise<HarnessInspection> {
  const configs = await Promise.all(
    MANIFEST.configFiles.map((file) => resolveConfig(file, context)),
  );
  const hook = configs.find((config) => config.declaration.path.endsWith('hooks.json'));
  const matchers = configs.flatMap((config) => config.matchers);
  const diagnostics: Diagnostic[] = hook?.configuredPoints.length
    ? [
        diagnostic({
          severity: 'info',
          code: 'hook-enablement-unobservable',
          subject: CODEX,
          message:
            'Codex declares this hook, but its persisted enablement and trust state cannot be read outside the TUI',
          path: hook.path,
          remediation: 'Open Codex and confirm the hook is enabled and trusted after any hook edit',
        }),
      ]
    : [];
  return {
    harnessId: CODEX,
    configs,
    activeToolFamilies: familiesOnThisPlatform(MANIFEST, context.facts),
    /**
     * Computed, not asserted.
     *
     * This was `[]`, which claims every shell-executing tool family is covered rather than
     * checking. The Claude adapter computes it, and computing it is how the Phase 2.5 spike found
     * that a `Bash` matcher left PowerShell bypassed. Codex declares one family today, so the
     * answer is usually the same — but a matcher that covers nothing would have gone unreported.
     *
     * `matcherCoversFamily` handles Codex's regex spelling: the live matcher is `^Bash$`, not
     * `Bash`, and a literal comparison would call the covered family uncovered.
     */
    uncoveredToolFamilies: familiesOnThisPlatform(MANIFEST, context.facts)
      .filter((family) => family.executesShellCommands)
      .filter(
        (family) =>
          matchers.length > 0 &&
          !matchers.some((matcher) => matcherCoversFamily(matcher, family.id)),
      )
      .map((family) => family.id),
    enabled: null,
    summaries: configs
      .filter((config) => config.configuredPoints.length > 0)
      .map((config) => ({
        harnessId: CODEX,
        configPath: config.path,
        scope: config.declaration.scope,
        interceptionPoints: config.configuredPoints,
        matchers: config.matchers,
        commands: config.commands,
      })),
    diagnostics,
  };
}

async function verify(context: HarnessContext): Promise<HarnessVerification> {
  const detection = await detect(context);
  const inspection = await inspect(context);
  const hook = inspection.configs.find((config) => config.declaration.path.endsWith('hooks.json'));
  const configured = (hook?.configuredPoints.length ?? 0) > 0;
  const readable = hook !== undefined && hook.exists && hook.parsed;
  const checks: VerificationCheck[] = [
    {
      id: 'executable-resolves',
      status: detection.version === null ? 'fail' : 'pass',
      summary:
        detection.version === null
          ? 'codex could not be run'
          : `Codex ${detection.version} resolves`,
      achievedTier: detection.version === null ? null : 'presence',
      evidence: detection.evidence.filter((item) => item.kind === 'version-output'),
      remediation: detection.version === null ? 'Install Codex CLI or add it to PATH' : null,
    },
    {
      id: 'hooks-readable',
      status: hook?.exists && !hook.parsed ? 'fail' : readable ? 'pass' : 'not-exercised',
      summary:
        hook?.exists && !hook.parsed
          ? 'hooks.json is not valid JSON'
          : readable
            ? 'hooks.json is readable'
            : 'hooks.json does not exist yet',
      achievedTier: null,
      evidence: [],
      remediation: hook?.exists && !hook.parsed ? 'Repair the JSON syntax' : null,
    },
    {
      id: 'hook-registered',
      status: configured ? 'pass' : 'not-exercised',
      // Named from what was found rather than hardcoded, now that both events are read: saying
      // "PostToolUse" about a PreToolUse entry would be a report about the wrong surface.
      summary: configured
        ? `${(hook?.configuredPoints ?? []).join(', ')} entry is declared`
        : 'No hook entry is declared',
      achievedTier: configured ? 'config-only' : null,
      evidence: [],
      remediation: configured ? null : 'Configure or adopt a Codex hook',
    },
    {
      id: 'hook-enablement',
      status: configured ? 'info' : 'not-exercised',
      summary: configured
        ? 'Enablement and trust are separate persisted state and are not observable from this adapter'
        : 'No declared hook has enablement to inspect',
      achievedTier: null,
      evidence: [],
      remediation: configured
        ? 'Confirm in the Codex TUI that the hook is enabled and trusted'
        : null,
    },
    {
      id: 'canary-intercepted',
      status: 'not-exercised',
      summary: 'No positive event-stream receipt has been observed for this integration',
      achievedTier: null,
      evidence: [],
      remediation: null,
    },
  ];
  return {
    harnessId: CODEX,
    declaredTier: MANIFEST.verificationTier,
    achievedTier:
      detection.version !== null && readable && configured
        ? 'config-only'
        : detection.version !== null
          ? 'presence'
          : null,
    checks,
  };
}

function readNumber(record: Record<string, JsonValue>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, JsonValue>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function scopeForDuration(minutes: number | null): 'five-hour' | 'weekly' | 'monthly' | 'unknown' {
  if (minutes === 300) return 'five-hour';
  if (minutes === 10_080) return 'weekly';
  if (minutes === 43_200) return 'monthly';
  return 'unknown';
}

function resetInstant(epochSeconds: number | null): string | null {
  if (epochSeconds === null || epochSeconds < 0) return null;
  const date = new Date(epochSeconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rateWindow(
  value: JsonValue | undefined,
  input: {
    bucketId: string | null;
    bucketName: string | null;
    window: 'primary' | 'secondary';
    observedAt: string;
  },
): HarnessBudgetObservation['windows'][number] | null {
  if (!isRecord(value)) return null;
  const usedPercent = readNumber(value, 'usedPercent');
  const duration = readNumber(value, 'windowDurationMins');
  const resetsAt = readNumber(value, 'resetsAt');
  return {
    harnessId: CODEX,
    bucketId: input.bucketId,
    bucketName: input.bucketName,
    window: input.window,
    scope: scopeForDuration(duration),
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    windowDurationMinutes: duration,
    resetsAt: resetInstant(resetsAt),
    observedAt: input.observedAt,
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}

function snapshotWindows(
  value: JsonValue,
  observedAt: string,
  fallbackBucketId: string | null,
): {
  windows: HarnessBudgetObservation['windows'];
  planType: string | null;
  rateLimitReachedType: string | null;
} {
  if (!isRecord(value)) return { windows: [], planType: null, rateLimitReachedType: null };
  const bucketId = readString(value, 'limitId') ?? fallbackBucketId;
  const bucketName = readString(value, 'limitName');
  const primary = rateWindow(value['primary'], {
    bucketId,
    bucketName,
    window: 'primary',
    observedAt,
  });
  const secondary = rateWindow(value['secondary'], {
    bucketId,
    bucketName,
    window: 'secondary',
    observedAt,
  });
  return {
    windows: [primary, secondary].filter(
      (window): window is NonNullable<typeof window> => window !== null,
    ),
    planType: readString(value, 'planType'),
    rateLimitReachedType: readString(value, 'rateLimitReachedType'),
  };
}

function parseRateLimitResponse(
  stdout: string,
  observedAt: string,
): Omit<HarnessBudgetObservation, 'harnessId' | 'state' | 'diagnostics'> | null {
  const messages: JsonValue[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      messages.push(JSON.parse(line) as JsonValue);
    } catch {
      // Tracing belongs on stderr, but a future version may print an unrelated stdout line.
    }
  }

  const response = messages.find(
    (message) => isRecord(message) && message['id'] === 2 && isRecord(message['result']),
  );
  if (!isRecord(response) || !isRecord(response['result'])) return null;
  const result = response['result'];

  const snapshots: Array<{ id: string | null; value: JsonValue }> = [];
  const byId = result['rateLimitsByLimitId'];
  if (isRecord(byId)) {
    for (const [id, value] of Object.entries(byId)) {
      if (value !== undefined) snapshots.push({ id, value });
    }
  }
  if (snapshots.length === 0 && result['rateLimits'] !== undefined) {
    snapshots.push({ id: null, value: result['rateLimits'] });
  }

  const windows: HarnessBudgetObservation['windows'] = [];
  let planType: string | null = null;
  let rateLimitReachedType: string | null = null;
  for (const snapshot of snapshots) {
    const parsed = snapshotWindows(snapshot.value, observedAt, snapshot.id);
    windows.push(...parsed.windows);
    planType ??= parsed.planType;
    rateLimitReachedType ??= parsed.rateLimitReachedType;
  }

  let resetCreditsAvailable: number | null = null;
  const resetCredits = result['rateLimitResetCredits'];
  if (isRecord(resetCredits)) {
    const available = readNumber(resetCredits, 'availableCount');
    resetCreditsAvailable = available === null ? null : Math.max(0, Math.trunc(available));
  }

  return { windows, planType, rateLimitReachedType, resetCreditsAvailable };
}

async function observeUsage(
  context: HarnessContext,
  observedAt: string,
): Promise<HarnessBudgetObservation> {
  const stdin = [
    JSON.stringify({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'token_harness',
          title: 'Token Harness',
          version: '0.1',
        },
      },
    }),
    JSON.stringify({ method: 'initialized', params: {} }),
    JSON.stringify({ method: 'account/rateLimits/read', id: 2, params: {} }),
    '',
  ].join('\n');

  const outcome = await context.runner.run({
    executable: 'codex',
    args: ['app-server', '--stdio'],
    cwd: context.projectRoot,
    stdin,
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
  });

  if (outcome.failure !== null) {
    return {
      harnessId: CODEX,
      state: outcome.failure.reason === 'executable-not-found' ? 'absent' : 'unavailable',
      windows: [],
      planType: null,
      rateLimitReachedType: null,
      resetCreditsAvailable: null,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'codex-rate-limits-unavailable',
          subject: CODEX,
          message: 'Codex rate limits could not be read: ' + outcome.failure.message,
          remediation:
            'Run Codex once, confirm ChatGPT authentication, then retry token-harness budget',
        }),
      ],
    };
  }

  if (outcome.exitCode !== 0) {
    return {
      harnessId: CODEX,
      state: 'unavailable',
      windows: [],
      planType: null,
      rateLimitReachedType: null,
      resetCreditsAvailable: null,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'codex-rate-limits-unavailable',
          subject: CODEX,
          message:
            'Codex app-server exited ' +
            String(outcome.exitCode) +
            ' without a usable rate-limit snapshot',
          remediation: 'Check codex app-server --help and the installed Codex authentication state',
        }),
      ],
    };
  }

  const parsed = parseRateLimitResponse(outcome.stdout, observedAt);
  if (parsed === null) {
    return {
      harnessId: CODEX,
      state: 'unavailable',
      windows: [],
      planType: null,
      rateLimitReachedType: null,
      resetCreditsAvailable: null,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'codex-rate-limits-schema-unrecognized',
          subject: CODEX,
          message: 'Codex app-server returned no recognizable account/rateLimits/read response',
          remediation: 'Refresh the Codex compatibility fixture before relying on this version',
        }),
      ],
    };
  }

  return {
    harnessId: CODEX,
    state: parsed.windows.length > 0 ? 'observed' : 'unavailable',
    ...parsed,
    diagnostics:
      parsed.windows.length > 0
        ? []
        : [
            diagnostic({
              severity: 'warning',
              code: 'codex-rate-limits-empty',
              subject: CODEX,
              message: 'Codex returned a rate-limit response without any readable usage windows',
              remediation:
                'Treat current Codex quota as unknown and retry after a normal Codex session',
            }),
          ],
  };
}

function readBoolean(record: Record<string, JsonValue>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readStringArray(record: Record<string, JsonValue>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function utf8Bytes(value: string | null): number {
  return value === null ? 0 : new TextEncoder().encode(value).byteLength;
}

function rpcResult(messages: JsonValue[], id: number): Record<string, JsonValue> | null {
  const response = messages.find(
    (message) => isRecord(message) && message['id'] === id && isRecord(message['result']),
  );
  return isRecord(response) && isRecord(response['result']) ? response['result'] : null;
}

function parseJsonLines(stdout: string): JsonValue[] {
  const messages: JsonValue[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      messages.push(JSON.parse(line) as JsonValue);
    } catch {
      // App-server tracing belongs on stderr. Ignore unrelated stdout rather than guessing.
    }
  }
  return messages;
}

async function observeContext(
  context: HarnessContext,
  _observedAt: string,
): Promise<HarnessContextObservation> {
  const stdin = [
    JSON.stringify({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'token_harness',
          title: 'Token Harness',
          version: '0.1',
        },
      },
    }),
    JSON.stringify({ method: 'initialized', params: {} }),
    JSON.stringify({
      method: 'config/read',
      id: 2,
      params: { cwd: context.projectRoot, includeLayers: true },
    }),
    JSON.stringify({
      method: 'mcpServerStatus/list',
      id: 3,
      params: { limit: 1000, detail: 'toolsAndAuthOnly' },
    }),
    JSON.stringify({
      method: 'model/list',
      id: 4,
      params: { limit: 1000, includeHidden: false },
    }),
    '',
  ].join('\n');

  const outcome = await context.runner.run({
    executable: 'codex',
    args: ['app-server', '--stdio'],
    cwd: context.projectRoot,
    stdin,
    timeoutMs: 15_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });

  const unavailable = (
    state: HarnessContextObservation['state'],
    code: string,
    message: string,
  ): HarnessContextObservation => ({
    harnessId: CODEX,
    state,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    projectDocMaxBytes: null,
    toolOutputTokenLimit: null,
    toolSearchEnabled: null,
    projectRootMarkers: null,
    projectDocFallbackFilenames: [],
    configInstructionBytes: null,
    managedConfigTarget: null,
    managedConfigFieldOrigins: [],
    availableModels: [],
    modelCatalogTruncated: false,
    mcpServers: [],
    mcpInventoryTruncated: false,
    diagnostics: [
      diagnostic({
        severity: 'warning',
        code,
        subject: CODEX,
        message,
        remediation: 'Update Codex and retry token-harness context',
      }),
    ],
  });

  if (outcome.failure !== null) {
    return unavailable(
      outcome.failure.reason === 'executable-not-found' ? 'absent' : 'unavailable',
      'codex-context-unavailable',
      'Codex context inventory could not be read: ' + outcome.failure.message,
    );
  }
  if (outcome.exitCode !== 0) {
    return unavailable(
      'unavailable',
      'codex-context-unavailable',
      'Codex app-server exited ' + String(outcome.exitCode) + ' during context inventory',
    );
  }

  const messages = parseJsonLines(outcome.stdout);
  const configResponse = rpcResult(messages, 2);
  const mcpResponse = rpcResult(messages, 3);
  const modelResponse = rpcResult(messages, 4);
  const config =
    configResponse !== null && isRecord(configResponse['config']) ? configResponse['config'] : null;

  const managedConfigTarget: HarnessContextObservation['managedConfigTarget'] = (() => {
    const layers = configResponse?.['layers'];
    if (!Array.isArray(layers)) return null;
    for (const layer of layers) {
      if (!isRecord(layer)) continue;
      const source = isRecord(layer['name']) ? layer['name'] : null;
      if (source === null || readString(source, 'type') !== 'user') continue;
      // A selected profile is still user-owned. Phase 18.4 never adopts or rewrites one
      // implicitly; only the base user layer is a managed write target.
      if (readString(source, 'profile') !== null) continue;
      const path = readString(source, 'file');
      const version = readString(layer, 'version');
      if (path === null || version === null) continue;
      return {
        harnessId: CODEX,
        scope: 'user',
        path,
        version,
        source: 'native-rpc',
      };
    }
    return null;
  })();

  const managedConfigFieldOrigins: HarnessContextObservation['managedConfigFieldOrigins'] = [];
  const origins = configResponse !== null && isRecord(configResponse['origins'])
    ? configResponse['origins']
    : null;
  for (const keyPath of ['model', 'model_reasoning_effort', 'model_verbosity']) {
    const metadata = origins !== null && isRecord(origins[keyPath]) ? origins[keyPath] : null;
    const source = metadata !== null && isRecord(metadata['name']) ? metadata['name'] : null;
    if (metadata === null || source === null) continue;
    const sourceType = readString(source, 'type');
    const version = readString(metadata, 'version');
    if (sourceType === null || version === null) continue;
    const path = readString(source, 'file');
    const profile = readString(source, 'profile');
    managedConfigFieldOrigins.push({
      harnessId: CODEX,
      keyPath,
      sourceType,
      path,
      profile,
      version,
      matchesManagedTarget:
        managedConfigTarget !== null &&
        sourceType === 'user' &&
        profile === null &&
        path === managedConfigTarget.path &&
        version === managedConfigTarget.version,
      source: 'native-rpc',
    });
  }

  const features = config !== null && isRecord(config['features']) ? config['features'] : null;
  const instructions = config === null ? null : readString(config, 'instructions');
  const developerInstructions =
    config === null ? null : readString(config, 'developer_instructions');

  const availableModels: HarnessContextObservation['availableModels'] = [];
  const modelData = modelResponse?.['data'];
  if (Array.isArray(modelData)) {
    for (const item of modelData) {
      if (!isRecord(item)) continue;
      const id = readString(item, 'id');
      const model = readString(item, 'model');
      const displayName = readString(item, 'displayName');
      if (id === null || model === null || displayName === null) continue;
      const efforts: string[] = [];
      const effortOptions = item['supportedReasoningEfforts'];
      if (Array.isArray(effortOptions)) {
        for (const option of effortOptions) {
          if (!isRecord(option)) continue;
          const effort = readString(option, 'reasoningEffort');
          if (effort !== null) efforts.push(effort);
        }
      }
      availableModels.push({
        harnessId: CODEX,
        id,
        model,
        displayName,
        modelSpecialty: readString(item, 'modelSpecialty'),
        supportedReasoningEfforts: [...new Set(efforts)],
        defaultReasoningEffort: readString(item, 'defaultReasoningEffort'),
        isDefault: item['isDefault'] === true,
        source: 'native-rpc',
      });
    }
  }

  const modelCatalogTruncated =
    modelResponse !== null &&
    modelResponse['nextCursor'] !== null &&
    modelResponse['nextCursor'] !== undefined;

  const mcpServers: HarnessContextObservation['mcpServers'] = [];
  const data = mcpResponse?.['data'];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!isRecord(item)) continue;
      const name = readString(item, 'name');
      if (name === null) continue;
      const tools = isRecord(item['tools']) ? item['tools'] : null;
      mcpServers.push({
        harnessId: CODEX,
        name,
        toolCount: tools === null ? null : Object.keys(tools).length,
        runtimeStatus: readString(item, 'runtimeStatus'),
        authStatus: readString(item, 'authStatus'),
        pluginId: readString(item, 'pluginId'),
        source: 'native-rpc',
      });
    }
  }

  const mcpInventoryTruncated =
    mcpResponse !== null &&
    mcpResponse['nextCursor'] !== null &&
    mcpResponse['nextCursor'] !== undefined;

  const diagnostics: Diagnostic[] = [];
  if (config === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-config-read-unavailable',
        subject: CODEX,
        message: 'Codex returned no recognizable config/read result',
        remediation: 'Treat effective Codex configuration as unknown',
      }),
    );
  }
  if (config !== null && managedConfigTarget === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-managed-config-target-unavailable',
        subject: CODEX,
        message:
          'Codex effective config was readable, but no versioned base user config layer was returned',
        remediation:
          'Keep native policy advisory; do not guess a config.toml path or expectedVersion',
      }),
    );
  }
  if (modelResponse === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-model-catalog-unavailable',
        subject: CODEX,
        message: 'Codex returned no recognizable model/list result',
        remediation: 'Keep the current model; do not infer alternative model ids',
      }),
    );
  }
  if (modelCatalogTruncated) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-model-catalog-truncated',
        subject: CODEX,
        message: 'Codex model catalog exceeded the one-shot page size',
        remediation: 'Do not recommend a model absent from the returned catalog page',
      }),
    );
  }
  if (mcpResponse === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-mcp-inventory-unavailable',
        subject: CODEX,
        message: 'Codex returned no recognizable mcpServerStatus/list result',
        remediation: 'Treat Codex MCP overhead as unknown',
      }),
    );
  }
  if (mcpInventoryTruncated) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-mcp-inventory-truncated',
        subject: CODEX,
        message: 'Codex MCP inventory exceeded the one-shot page size',
        remediation: 'Treat the reported MCP/tool counts as lower bounds',
      }),
    );
  }

  const projectRootMarkers =
    config === null
      ? null
      : Array.isArray(config['project_root_markers'])
        ? readStringArray(config, 'project_root_markers')
        : null;

  return {
    harnessId: CODEX,
    state:
      config !== null && mcpResponse !== null && modelResponse !== null
        ? mcpInventoryTruncated || modelCatalogTruncated
          ? 'partial'
          : 'observed'
        : config !== null || mcpResponse !== null || modelResponse !== null
          ? 'partial'
          : 'unavailable',
    model: config === null ? null : readString(config, 'model'),
    reasoningEffort: config === null ? null : readString(config, 'model_reasoning_effort'),
    verbosity: config === null ? null : readString(config, 'model_verbosity'),
    projectDocMaxBytes: config === null ? null : readNumber(config, 'project_doc_max_bytes'),
    toolOutputTokenLimit: config === null ? null : readNumber(config, 'tool_output_token_limit'),
    toolSearchEnabled: features === null ? null : readBoolean(features, 'tool_search'),
    projectRootMarkers,
    projectDocFallbackFilenames:
      config === null ? [] : readStringArray(config, 'project_doc_fallback_filenames'),
    configInstructionBytes:
      config === null ? null : utf8Bytes(instructions) + utf8Bytes(developerInstructions),
    managedConfigTarget,
    managedConfigFieldOrigins,
    availableModels,
    modelCatalogTruncated,
    mcpServers,
    mcpInventoryTruncated,
    diagnostics,
  };
}

export const codexAdapter: HarnessAdapter = {
  manifest: MANIFEST,
  detect,
  inspect,
  verify,
  observeUsage,
  observeContext,
};

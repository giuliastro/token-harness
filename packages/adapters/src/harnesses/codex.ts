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
  type HarnessDetection,
  type HarnessManifest,
  type JsonValue,
  type VerificationCheck,
  type VersionVerdict,
} from '@token-harness/core';

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
  interceptionPoints: [{ scopeId: 'post-tool-use', eventName: 'PostToolUse' }],
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

function readHooks(document: JsonValue): { matchers: string[]; commands: string[] } {
  if (!isRecord(document) || !isRecord(document['hooks'])) return { matchers: [], commands: [] };
  const entries = document['hooks']['PostToolUse'];
  if (!Array.isArray(entries)) return { matchers: [], commands: [] };
  const matchers: string[] = [];
  const commands: string[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (typeof entry['matcher'] === 'string') matchers.push(entry['matcher']);
    if (Array.isArray(entry['hooks'])) {
      for (const hook of entry['hooks']) {
        if (isRecord(hook) && typeof hook['command'] === 'string') commands.push(hook['command']);
      }
    }
  }
  return { matchers: [...new Set(matchers)], commands: [...new Set(commands)] };
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
      configuredPoints: hooks.commands.length > 0 ? ['post-tool-use'] : [],
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
  const configured = hooks?.configuredPoints.length !== 0;
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
  const diagnostics: Diagnostic[] = hook?.configuredPoints.length
    ? [
        diagnostic({
          severity: 'info',
          code: 'hook-enablement-unobservable',
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
    uncoveredToolFamilies: [],
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
  const configured = hook?.configuredPoints.length !== 0;
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
      summary: configured ? 'PostToolUse entry is declared' : 'No PostToolUse entry is declared',
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

export const codexAdapter: HarnessAdapter = { manifest: MANIFEST, detect, inspect, verify };

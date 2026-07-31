/** OpenCode — PLAN §3.4 and RFC 0007 §Per-harness findings. */

import {
  classifyVersion,
  diagnostic,
  evidence,
  harnessId,
  MANIFEST_SCHEMA_VERSION,
  parseJsoncDocumentText,
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

const OPENCODE = harnessId('opencode');
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

const MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: OPENCODE,
  displayName: 'OpenCode',
  homepage: 'https://opencode.ai',
  /**
   * The version actually observed, not a round number.
   *
   * This read `1.0.0`–`1.0.0`, and the OpenCode on the machine this was reviewed against is
   * `1.18.9` — so every real user got `unknown-newer`, which `doctor` counts as a problem, and
   * every real machine exited 3. RFC 0006 §Exit codes forbids exactly that: "A supported
   * configuration must be able to exit 0. A declared limitation is not a problem, and reporting
   * it as one is the fastest way to teach users to ignore the exit code."
   *
   * A single point rather than a range, matching the Codex adapter: one version was observed, so
   * one version is claimed. An older 1.x reports `unknown-older`, which is a warning and not a
   * problem, and a newer one reports `unknown-newer` — which is then a true statement.
   */
  testedVersions: { minimum: '1.18.9', maximum: '1.18.9' },
  // RFC 0007: a managed provider can emit a receipt, but an adopted generated wrapper
  // has no externally observable receipt. The harness adapter alone therefore declares
  // the achievable baseline, not a promise about a provider it does not own.
  verificationTier: 'config-only',
  versionCommand: { executable: 'opencode', args: ['--version'] },
  interceptionPoints: [{ scopeId: 'tool-execute-after', eventName: 'tool.execute.after' }],
  configFiles: [
    { path: '.config/opencode/opencode.jsonc', scope: 'user', parser: 'jsonc', primary: true },
    { path: 'opencode.jsonc', scope: 'project', parser: 'jsonc', primary: false },
  ],
  toolFamilies: [
    { id: 'tool.execute', platforms: ['windows', 'macos', 'linux'], executesShellCommands: true },
  ],
  requiresEnablement: false,
  enablementNote: null,
  receiptFamily: 'none',
};

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pluginEntries(document: JsonValue): string[] {
  if (!isRecord(document) || !Array.isArray(document['plugin'])) return [];
  return document['plugin'].filter((item): item is string => typeof item === 'string');
}

async function resolveConfig(
  declaration: HarnessManifest['configFiles'][number],
  context: HarnessContext,
): Promise<ResolvedHarnessConfig> {
  const path = resolveConfigPath(declaration, context);
  const stat = await context.fs.stat(path);
  if (stat === null || stat.kind !== 'file') {
    return {
      declaration,
      path,
      exists: false,
      parsed: false,
      configuredPoints: [],
      matchers: [],
      commands: [],
    };
  }
  const parsed = parseJsoncDocumentText(new TextDecoder().decode(await context.fs.readFile(path)));
  if (parsed.state !== 'parsed') {
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
  const plugins = pluginEntries(parsed.document);
  return {
    declaration,
    path,
    exists: true,
    parsed: true,
    configuredPoints: plugins.length > 0 ? ['tool-execute-after'] : [],
    // The plugin API sees every tool result; this is not a shell matcher.
    matchers: plugins.length > 0 ? ['tool.execute'] : [],
    commands: plugins,
  };
}

async function detectVersion(
  context: HarnessContext,
): Promise<{ version: string | null; verdict: VersionVerdict | null; evidence: Evidence[] }> {
  const outcome = await context.runner.run({
    executable: 'opencode',
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
          source: 'opencode',
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
        source: 'opencode',
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
  const configured = present.filter((config) => config.configuredPoints.length > 0);
  const warnings: Diagnostic[] = [];
  if (present.some((config) => !config.parsed))
    warnings.push(
      diagnostic({
        severity: 'error',
        code: 'harness-config-unreadable',
        message:
          'This OpenCode configuration file is not valid JSONC, so its plugins cannot be read',
        path: present.find((config) => !config.parsed)?.path ?? null,
        remediation: 'Repair the JSONC syntax, then run the command again',
      }),
    );
  if (verdict === 'unknown-newer')
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-version-unknown-newer',
        message: `OpenCode ${String(version)} is newer than the observed configuration schema`,
        remediation: 'Check the release notes for plugin-schema changes before applying a plan',
      }),
    );
  const primary = present.find((config) => config.declaration.primary) ?? present[0] ?? null;
  return {
    harnessId: OPENCODE,
    state: present.some((config) => !config.parsed)
      ? 'broken'
      : configured.length > 0 && version !== null
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
          source:
            config.declaration.scope === 'user' ? 'user configuration' : 'project configuration',
          path: config.path,
          detail: config.parsed
            ? config.configuredPoints.length > 0
              ? 'declares plugin entries'
              : 'present with no plugins'
            : 'present but not valid JSONC',
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
  const activeToolFamilies = familiesOnThisPlatform(MANIFEST, context.facts);
  return {
    harnessId: OPENCODE,
    configs,
    activeToolFamilies,
    uncoveredToolFamilies: [],
    enabled: null,
    diagnostics: [],
    summaries: configs
      .filter((config) => config.configuredPoints.length > 0)
      .map((config) => ({
        harnessId: OPENCODE,
        configPath: config.path,
        scope: config.declaration.scope,
        interceptionPoints: config.configuredPoints,
        matchers: config.matchers,
        commands: config.commands,
      })),
  };
}

async function verify(context: HarnessContext): Promise<HarnessVerification> {
  const detection = await detect(context);
  const inspection = await inspect(context);
  const configured = inspection.configs.some((config) => config.configuredPoints.length > 0);
  const readable = inspection.configs
    .filter((config) => config.exists)
    .every((config) => config.parsed);
  const checks: VerificationCheck[] = [
    {
      id: 'executable-resolves',
      status: detection.version === null ? 'fail' : 'pass',
      summary:
        detection.version === null
          ? 'opencode could not be run'
          : `opencode ${detection.version} resolves`,
      achievedTier: detection.version === null ? null : 'presence',
      evidence: detection.evidence.filter((item) => item.kind === 'version-output'),
      remediation:
        detection.version === null ? 'Install OpenCode or make it available on PATH' : null,
    },
    {
      id: 'config-readable',
      status: !readable ? 'fail' : configured ? 'pass' : 'not-exercised',
      summary: !readable
        ? 'OpenCode configuration is not valid JSONC'
        : configured
          ? 'OpenCode plugin configuration is readable'
          : 'No OpenCode plugin configuration is present',
      achievedTier: configured && readable ? 'config-only' : null,
      evidence: [],
      remediation: !readable ? 'Repair the JSONC syntax, then run verify again' : null,
    },
    {
      id: 'plugin-registered',
      status: configured ? 'pass' : 'not-exercised',
      summary: configured
        ? 'A plugin entry is registered for tool.execute.after'
        : 'No plugin entry is registered',
      achievedTier: configured ? 'config-only' : null,
      evidence: [],
      remediation: configured
        ? null
        : 'Configure the OpenCode plugin, or adopt an existing configuration',
    },
    {
      id: 'canary-intercepted',
      status: 'not-exercised',
      summary: 'No observable receipt exists for an adopted generated plugin wrapper',
      achievedTier: null,
      evidence: [],
      remediation: null,
    },
  ];
  return {
    harnessId: OPENCODE,
    declaredTier: MANIFEST.verificationTier,
    achievedTier:
      detection.version !== null && configured && readable
        ? 'config-only'
        : detection.version !== null
          ? 'presence'
          : null,
    checks,
  };
}

export const opencodeAdapter: HarnessAdapter = { manifest: MANIFEST, detect, inspect, verify };

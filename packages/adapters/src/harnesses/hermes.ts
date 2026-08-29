/** Hermes Agent — user plugin installation and transform_tool_result seam. */
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

const HERMES = harnessId('hermes');
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;
const PLUGIN = 'harnesstrim';
const MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: HERMES,
  displayName: 'Hermes Agent',
  homepage: 'https://hermes-agent.nousresearch.com/docs/',
  // PLAN §9.0 observed Hermes Agent 0.19.0 on the second machine. Keep the range at
  // exactly that version until another real build is exercised.
  testedVersions: { minimum: '0.19.0', maximum: '0.19.0' },
  verificationTier: 'config-only',
  versionCommand: { executable: 'hermes', args: ['--version'] },
  interceptionPoints: [{ scopeId: 'transform-tool-result', eventName: 'transform_tool_result' }],
  configFiles: [
    {
      path: '.hermes/plugins/harnesstrim/plugin.yaml',
      scope: 'user',
      parser: 'markers',
      primary: true,
    },
    {
      path: '.hermes/plugins/harnesstrim/config.json',
      scope: 'user',
      parser: 'json',
      primary: false,
    },
  ],
  toolFamilies: [
    { id: 'tool.result', platforms: ['windows', 'macos', 'linux'], executesShellCommands: false },
  ],
  requiresEnablement: true,
  enablementNote: 'The plugin must be enabled with `hermes plugins enable harnesstrim`.',
  receiptFamily: 'provider-telemetry',
};

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
  const text = new TextDecoder().decode(await context.fs.readFile(path));
  const parsed =
    declaration.parser === 'json'
      ? (() => {
          try {
            return JSON.parse(text) as JsonValue;
          } catch {
            return null;
          }
        })()
      : text;
  const valid = parsed !== null;
  return {
    declaration,
    path,
    exists: true,
    parsed: valid,
    configuredPoints:
      valid && declaration.path.endsWith('plugin.yaml') ? ['transform-tool-result'] : [],
    matchers: valid && declaration.path.endsWith('plugin.yaml') ? ['tool.result'] : [],
    commands:
      valid && declaration.path.endsWith('plugin.yaml')
        ? ['hermes plugins enable harnesstrim']
        : [],
  };
}

async function version(
  context: HarnessContext,
): Promise<{ value: string | null; verdict: VersionVerdict | null; evidence: Evidence[] }> {
  const result = await context.runner.run({
    executable: 'hermes',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (result.failure !== null)
    return {
      value: null,
      verdict: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: 'hermes',
          detail: `not runnable: ${result.failure.reason}`,
        }),
      ],
    };
  const value = VERSION_PATTERN.exec(result.stdout)?.[1] ?? null;
  return {
    value,
    verdict: value === null ? null : classifyVersion(value, MANIFEST.testedVersions),
    evidence: [
      evidence({
        kind: 'version-output',
        source: 'hermes',
        path: result.executablePath,
        detail: value ? `reported ${value}` : 'reported no recognisable version',
      }),
    ],
  };
}

async function enabled(context: HarnessContext): Promise<boolean | null> {
  const result = await context.runner.run({
    executable: 'hermes',
    args: ['plugins', 'list'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (result.failure !== null || result.exitCode !== 0) return null;
  const line = result.stdout.split('\n').find((entry) => entry.toLowerCase().includes(PLUGIN));
  return line === undefined ? false : /enabled/i.test(line);
}

async function detect(context: HarnessContext): Promise<HarnessDetection> {
  const observed = await version(context);
  const configs = await Promise.all(
    MANIFEST.configFiles.map((file) => resolveConfig(file, context)),
  );
  const plugin = configs.find((file) => file.declaration.path.endsWith('plugin.yaml'));
  const isEnabled = await enabled(context);
  const warnings: Diagnostic[] = [];
  if (observed.verdict === 'unknown-newer')
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-version-unknown-newer',
        message: `Hermes ${observed.value} is newer than the observed plugin contract`,
        remediation: 'Review the transform_tool_result plugin contract before applying changes',
      }),
    );
  if (plugin?.exists && isEnabled === false)
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'plugin-disabled',
        message: 'HarnessTrim is installed in Hermes but is not enabled',
        path: plugin.path,
        remediation: 'Run `hermes plugins enable harnesstrim`',
      }),
    );
  const present = plugin?.exists === true;
  return {
    harnessId: HERMES,
    state:
      present && isEnabled === true && observed.value !== null
        ? 'configured'
        : present || observed.value !== null
          ? 'detected'
          : 'absent',
    version: observed.value,
    versionVerdict: observed.verdict,
    configPath: plugin?.path ?? null,
    declaredVerificationTier: MANIFEST.verificationTier,
    evidence: [
      ...observed.evidence,
      ...(plugin
        ? [
            evidence({
              kind: 'config-entry',
              source: 'Hermes plugin directory',
              path: plugin.path,
              detail: plugin.exists
                ? 'HarnessTrim plugin manifest present'
                : 'plugin manifest absent',
            }),
          ]
        : []),
    ],
    warnings,
  };
}

async function inspect(context: HarnessContext): Promise<HarnessInspection> {
  const configs = await Promise.all(
    MANIFEST.configFiles.map((file) => resolveConfig(file, context)),
  );
  return {
    harnessId: HERMES,
    configs,
    activeToolFamilies: familiesOnThisPlatform(MANIFEST, context.facts),
    uncoveredToolFamilies: [],
    enabled: await enabled(context),
    diagnostics: [],
    summaries: configs
      .filter((config) => config.configuredPoints.length > 0)
      .map((config) => ({
        harnessId: HERMES,
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
  const plugin = inspection.configs.some((config) => config.configuredPoints.length > 0);
  const checks: VerificationCheck[] = [
    {
      id: 'executable-resolves',
      status: detection.version === null ? 'fail' : 'pass',
      summary:
        detection.version === null ? 'hermes could not be run' : `Hermes ${detection.version}`,
      achievedTier: detection.version === null ? null : 'presence',
      evidence: detection.evidence.filter((item) => item.kind === 'version-output'),
      remediation: detection.version === null ? 'Install Hermes or add it to PATH' : null,
    },
    {
      id: 'plugin-installed',
      status: plugin ? 'pass' : 'fail',
      summary: plugin
        ? 'HarnessTrim plugin manifest is installed'
        : 'HarnessTrim plugin manifest is missing',
      achievedTier: plugin ? 'config-only' : null,
      evidence: [],
      remediation: plugin ? null : 'Run `harnesstrim install hermes --apply`',
    },
    {
      id: 'plugin-enabled',
      status:
        inspection.enabled === true
          ? 'pass'
          : inspection.enabled === false
            ? 'fail'
            : 'not-exercised',
      summary:
        inspection.enabled === true
          ? 'HarnessTrim is enabled'
          : inspection.enabled === false
            ? 'HarnessTrim is installed but disabled'
            : 'Hermes plugin state could not be read',
      achievedTier: inspection.enabled === true ? 'config-only' : null,
      evidence: [],
      remediation: inspection.enabled === false ? 'Run `hermes plugins enable harnesstrim`' : null,
    },
    {
      id: 'canary-intercepted',
      status: 'not-exercised',
      summary:
        'Hermes exposes no independent receipt; HarnessTrim telemetry is verified by the provider adapter',
      achievedTier: null,
      evidence: [],
      remediation: null,
    },
  ];
  return {
    harnessId: HERMES,
    declaredTier: MANIFEST.verificationTier,
    achievedTier: checks.some((check) => check.achievedTier === 'config-only')
      ? 'config-only'
      : checks.some((check) => check.achievedTier === 'presence')
        ? 'presence'
        : null,
    checks,
  };
}

export const hermesAdapter: HarnessAdapter = { manifest: MANIFEST, detect, inspect, verify };

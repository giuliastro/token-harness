/** Pi — extension module auto-loaded from the Pi extension directories. */
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

const PI = harnessId('pi');
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

const MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: PI,
  displayName: 'Pi',
  // The npm package declares no `homepage`; the repository it ships is the documented home.
  homepage: 'https://github.com/earendil-works/pi',
  // Only the version actually observed — PLAN §15 item 31, "tested range of exactly the observed
  // version". `pi --version` on the machine this was written against printed `0.83.0`.
  testedVersions: { minimum: '0.83.0', maximum: '0.83.0' },
  // RFC 0007: the extension emits no receipt of its own, so nothing above `config-only` is
  // provable. The configuration is the extension module sitting in an auto-loaded directory.
  verificationTier: 'config-only',
  versionCommand: { executable: 'pi', args: ['--version'] },
  interceptionPoints: [{ scopeId: 'tool-result', eventName: 'tool_result' }],
  // `markers` because there is nothing to parse: Pi auto-loads any module in these directories,
  // and the presence of the HarnessTrim extension file is the whole configuration.
  configFiles: [
    {
      path: '.pi/agent/extensions/harnesstrim/index.ts',
      scope: 'user',
      parser: 'markers',
      primary: true,
    },
    {
      path: '.pi/extensions/harnesstrim/index.ts',
      scope: 'project',
      parser: 'markers',
      primary: false,
    },
  ],
  // The extension intercepts `tool_result` and reduces text chunks — a content seam, never a
  // shell. Mirrors the OpenCode plugin API claim.
  toolFamilies: [
    { id: 'tool.result', platforms: ['windows', 'macos', 'linux'], executesShellCommands: false },
  ],
  // There is no separate enable state: the module being present in the directory is the load
  // decision, so the adapter reads presence and nothing else.
  requiresEnablement: false,
  enablementNote: null,
  receiptFamily: 'none',
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
  // The guard HarnessTrim's own installer writes — the same check the extension performs at
  // load. Case-insensitive because the generated header says "HarnessTrim" and the runtime
  // options spell it "harnesstrim".
  const isHarnesstrim = /harnesstrim/i.test(text);
  return {
    declaration,
    path,
    exists: true,
    parsed: isHarnesstrim,
    configuredPoints: isHarnesstrim ? ['tool-result'] : [],
    matchers: isHarnesstrim ? ['tool.result'] : [],
    // There is no enable command: Pi loads the module from the directory directly.
    commands: [],
  };
}

async function detectVersion(
  context: HarnessContext,
): Promise<{ value: string | null; verdict: VersionVerdict | null; evidence: Evidence[] }> {
  const result = await context.runner.run({
    executable: 'pi',
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
          source: 'pi',
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
        source: 'pi',
        path: result.executablePath,
        detail: value ? `reported ${value}` : 'reported no recognisable version',
      }),
    ],
  };
}

async function detect(context: HarnessContext): Promise<HarnessDetection> {
  const observed = await detectVersion(context);
  const configs = await Promise.all(
    MANIFEST.configFiles.map((file) => resolveConfig(file, context)),
  );
  const module = configs.find((file) => file.parsed);
  const present = module !== undefined;
  const warnings: Diagnostic[] = [];
  if (observed.verdict === 'unknown-newer')
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-version-unknown-newer',
        message: `Pi ${observed.value} is newer than the observed extension contract`,
        remediation: 'Review the tool_result extension contract before applying changes',
      }),
    );
  return {
    harnessId: PI,
    state:
      present && observed.value !== null
        ? 'configured'
        : present || observed.value !== null
          ? 'detected'
          : 'absent',
    version: observed.value,
    versionVerdict: observed.verdict,
    configPath: module?.path ?? null,
    declaredVerificationTier: MANIFEST.verificationTier,
    evidence: [
      ...observed.evidence,
      ...(module
        ? [
            evidence({
              kind: 'config-entry',
              source: 'HarnessTrim Pi extension',
              path: module.path,
              detail: 'extension module present in an auto-loaded directory',
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
    harnessId: PI,
    configs,
    activeToolFamilies: familiesOnThisPlatform(MANIFEST, context.facts),
    uncoveredToolFamilies: [],
    // No separate enablement exists, so nothing is reported as enabled or disabled.
    enabled: null,
    diagnostics: [],
    summaries: configs
      .filter((config) => config.configuredPoints.length > 0)
      .map((config) => ({
        harnessId: PI,
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
  const module = inspection.configs.some((config) => config.configuredPoints.length > 0);
  const checks: VerificationCheck[] = [
    {
      id: 'executable-resolves',
      status: detection.version === null ? 'fail' : 'pass',
      summary: detection.version === null ? 'pi could not be run' : `Pi ${detection.version}`,
      achievedTier: detection.version === null ? null : 'presence',
      evidence: detection.evidence.filter((item) => item.kind === 'version-output'),
      remediation: detection.version === null ? 'Install Pi or add it to PATH' : null,
    },
    {
      id: 'module-installed',
      // The HarnessTrim extension is optional. `verify` answers whether existing integrations are
      // healthy; it must not turn an installed Pi executable into a warning merely because the
      // user never chose to integrate HarnessTrim with it.
      status: module ? 'pass' : 'not-exercised',
      summary: module
        ? 'HarnessTrim extension module is installed'
        : 'HarnessTrim is not configured on Pi, so there is no Pi integration to verify',
      achievedTier: module ? 'config-only' : null,
      evidence: [],
      remediation: null,
    },
    {
      id: 'mode-unreadable',
      status: module ? 'info' : 'pass',
      summary: module
        ? 'The effective reduction mode (HARNESSTRIM_MODE) defaults to dryrun and is not observable from the extension alone'
        : 'no HarnessTrim Pi mode applies because no extension is configured',
      achievedTier: null,
      evidence: [],
      remediation: null,
    },
    {
      id: 'canary-intercepted',
      status: module ? 'not-exercised' : 'pass',
      summary: module
        ? 'Pi exposes no independent receipt; HarnessTrim telemetry is verified by the provider adapter'
        : 'no HarnessTrim Pi canary applies because no extension is configured',
      achievedTier: null,
      evidence: [],
      remediation: null,
    },
  ];
  return {
    harnessId: PI,
    declaredTier: MANIFEST.verificationTier,
    achievedTier: checks.some((check) => check.achievedTier === 'config-only')
      ? 'config-only'
      : checks.some((check) => check.achievedTier === 'presence')
        ? 'presence'
        : null,
    checks,
  };
}

export const piAdapter: HarnessAdapter = { manifest: MANIFEST, detect, inspect, verify };
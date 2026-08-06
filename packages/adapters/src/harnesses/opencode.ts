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
   * A range now, because spike 9.1 observed two more: the CLI at `1.18.11` and OpenCode Desktop at
   * `1.18.14`, both loading plugins from the same directories. The span is what was watched, not a
   * guess that every 1.18.x behaves alike — and the two ends differ in a way that matters, which is
   * exactly why both are named. An older 1.x reports `unknown-older`, which is a warning and not a
   * problem, and a newer one reports `unknown-newer` — which is then a true statement.
   */
  testedVersions: { minimum: '1.18.9', maximum: '1.18.14' },
  // RFC 0007: a managed provider can emit a receipt, but an adopted generated wrapper
  // has no externally observable receipt. The harness adapter alone therefore declares
  // the achievable baseline, not a promise about a provider it does not own.
  verificationTier: 'config-only',
  versionCommand: { executable: 'opencode', args: ['--version'] },
  interceptionPoints: [
    { scopeId: 'tool-execute-before', eventName: 'tool.execute.before' },
    { scopeId: 'tool-execute-after', eventName: 'tool.execute.after' },
  ],
  /**
   * Two kinds of entry, because OpenCode has two ways to register a plugin and only one of them is
   * a document.
   *
   * The `opencode.jsonc` files carry a `plugin` string array. The directories are auto-loaded: any
   * module dropped in one is registered without being named anywhere, which is how both real
   * integrations install — `rtk init -g --opencode` writes `.config/opencode/plugins/rtk.ts` and
   * touches no JSON at all, and HarnessTrim's generated wrapper says in its own header not to
   * reference it from `opencode.json`. An adapter that read only the array would report every such
   * installation as absent, which is the state this file was in before spike 9.1.
   *
   * Both spellings are listed because both load. Spike 9.1 put a probe in each and one run fired
   * both; the upstream documentation names the plural, the binary carries both strings, and the two
   * shipped integrations disagree with each other about which to use.
   *
   * `markers` is the parser because there is nothing to parse: the presence of a file is the
   * configuration, and its contents are a plugin module rather than a document this build reads.
   */
  configFiles: [
    { path: '.config/opencode/opencode.jsonc', scope: 'user', parser: 'jsonc', primary: true },
    { path: 'opencode.jsonc', scope: 'project', parser: 'jsonc', primary: false },
    { path: '.config/opencode/plugins', scope: 'user', parser: 'markers', primary: false },
    { path: '.config/opencode/plugin', scope: 'user', parser: 'markers', primary: false },
    { path: '.opencode/plugins', scope: 'project', parser: 'markers', primary: false },
    { path: '.opencode/plugin', scope: 'project', parser: 'markers', primary: false },
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

/** Module suffixes OpenCode will auto-load from a plugin directory. */
const PLUGIN_MODULE_PATTERN = /\.(ts|js|mjs|cjs|mts|cts)$/i;

/**
 * Every interception point a registered plugin could be using.
 *
 * A plugin is a module, and which hooks it returns is decided when it runs. Nothing short of
 * executing it says whether it took `tool.execute.before`, `tool.execute.after`, or both — RTK
 * takes the first, HarnessTrim the second, and neither declares it anywhere readable. Reporting
 * both is the claim that the point is occupied, which is what the resolver needs to see a contest;
 * narrowing it to one would be a guess that hides a real conflict whenever the guess is wrong.
 */
const PLUGIN_POINTS = ['tool-execute-before', 'tool-execute-after'];

/**
 * A plugin directory: its entries are the configuration.
 *
 * The discovered module paths go into `commands` verbatim, which is the seam a provider adapter
 * recognises itself in. That is the only way an integration installed as a file — every real one —
 * can be attributed to the provider that installed it.
 */
async function resolvePluginDirectory(
  declaration: HarnessManifest['configFiles'][number],
  context: HarnessContext,
): Promise<ResolvedHarnessConfig> {
  const path = resolveConfigPath(declaration, context);
  const stat = await context.fs.stat(path);
  if (stat === null || stat.kind !== 'directory') {
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
  const modules = (await context.fs.readDirectory(path)).filter((entry) =>
    PLUGIN_MODULE_PATTERN.test(entry),
  );
  return {
    declaration,
    path,
    exists: true,
    // A directory listing cannot fail to parse. `markers` declares that there is nothing to read.
    parsed: true,
    configuredPoints: modules.length > 0 ? [...PLUGIN_POINTS] : [],
    // The plugin API sees every tool result; this is not a shell matcher.
    matchers: modules.length > 0 ? ['tool.execute'] : [],
    commands: modules.map((entry) => context.fs.join(path, entry)),
  };
}

async function resolveConfig(
  declaration: HarnessManifest['configFiles'][number],
  context: HarnessContext,
): Promise<ResolvedHarnessConfig> {
  if (declaration.parser === 'markers') return resolvePluginDirectory(declaration, context);
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
    // A `plugin` array entry is the same kind of thing as a module in a plugin directory: a
    // registration whose hooks are only known once it runs. Same claim, same reason.
    configuredPoints: plugins.length > 0 ? [...PLUGIN_POINTS] : [],
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

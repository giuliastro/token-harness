/**
 * Claude Code — PLAN §3.3, written against RFC 0007.
 *
 * The first harness adapter, and PLAN §15 issue 10 says the first should be Codex. The
 * inversion is deliberate and was agreed: the Phase 2.5 spike reached tier 3 on Claude
 * Code and could not declare a tier for Codex without writing to the user's
 * configuration, so Codex is the harness whose verification surface is still open.
 * Writing an adapter against an open surface is what PLAN §4 puts the spike before the
 * adapters to avoid.
 *
 * Three things here come from the spike rather than from documentation:
 *
 * - hooks live in **strict JSON** at `hooks.PreToolUse[]`, so the owning action is a
 *   JSON merge and never a marker fence. RFC 0006 §Golden path was amended accordingly;
 * - the harness exposes a **PowerShell** tool family on Windows that a `Bash` matcher
 *   does not cover, which `inspect` reports as an uncovered scope;
 * - the receipt is **provider-side**. Claude Code has no machine-readable event stream
 *   this adapter can read, so `verify` here reaches `config-only` and reports the canary
 *   check as `not-exercised` rather than claiming a tier it cannot demonstrate. The
 *   passive receipt lives in RTK's analytics and arrives with the provider adapter.
 */

import {
  classifyVersion,
  diagnostic,
  evidence,
  harnessId,
  MANIFEST_SCHEMA_VERSION,
  type Diagnostic,
  type Evidence,
  type HarnessContextObservation,
  type HarnessDetection,
  type HarnessManifest,
  type HarnessState,
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

const CLAUDE = harnessId('claude');

/**
 * The tested range is a claim about the *configuration schema*, not about a test suite.
 * `2.1.212` is the version whose `settings.json` the Phase 2.5 spike actually read and
 * whose hook shape this adapter is written against. Anything newer gets RFC 0002's
 * unknown-newer warning and conservative behaviour, which is the correct answer for a
 * schema nobody has looked at.
 */
const MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: CLAUDE,
  displayName: 'Claude Code',
  homepage: 'https://claude.com/claude-code',
  testedVersions: { minimum: '2.0.0', maximum: '2.1.212' },
  // RFC 0007 §Per-harness findings: tier 3 was reached on this harness, passively,
  // through the provider's receipt. The adapter alone reaches `config-only`.
  verificationTier: 'canary',
  versionCommand: { executable: 'claude', args: ['--version'] },
  interceptionPoints: [
    { scopeId: 'pre-tool-use', eventName: 'PreToolUse' },
    { scopeId: 'post-tool-use', eventName: 'PostToolUse' },
  ],
  configFiles: [
    { path: '.claude/settings.json', scope: 'user', parser: 'json', primary: true },
    { path: '.claude/settings.json', scope: 'project', parser: 'json', primary: false },
    { path: '.claude/settings.local.json', scope: 'project', parser: 'json', primary: false },
  ],
  toolFamilies: [
    {
      id: 'Bash',
      platforms: ['windows', 'macos', 'linux'],
      executesShellCommands: true,
    },
    {
      // Observed in a Windows session: the harness offers a separate PowerShell tool,
      // and a hook matching `Bash` did not see commands routed through it.
      id: 'PowerShell',
      platforms: ['windows'],
      executesShellCommands: true,
    },
  ],
  requiresEnablement: false,
  enablementNote: null,
  receiptFamily: 'provider-telemetry',
};

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

interface HookEntry {
  matcher: string | null;
  count: number;
  /** The `command` strings on this entry, verbatim. */
  commands: string[];
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the hook entries a settings document declares, per interception point.
 *
 * Deliberately tolerant about *shape* and strict about *syntax*: a document that does not
 * parse is `broken` and reported, but a `hooks` block whose entries are missing a matcher
 * is simply an entry with no matcher, because the harness's own schema may grow fields
 * this build has never seen and refusing to read the file would be worse than reading
 * less of it.
 */
function readHooks(document: JsonValue): Map<string, HookEntry[]> {
  const found = new Map<string, HookEntry[]>();
  if (!isRecord(document)) return found;
  const hooks = document['hooks'];
  if (!isRecord(hooks)) return found;

  for (const point of MANIFEST.interceptionPoints) {
    const list = hooks[point.eventName];
    if (!Array.isArray(list) || list.length === 0) continue;
    const entries: HookEntry[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const matcher = item['matcher'];
      const inner = item['hooks'];
      const commands = Array.isArray(inner)
        ? inner
            .map((hook) => (isRecord(hook) ? hook['command'] : undefined))
            .filter((command): command is string => typeof command === 'string')
        : [];
      entries.push({
        matcher: typeof matcher === 'string' ? matcher : null,
        count: Array.isArray(inner) ? inner.length : 0,
        commands,
      });
    }
    if (entries.length > 0) found.set(point.scopeId, entries);
  }
  return found;
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

  let document: JsonValue | null = null;
  try {
    document = JSON.parse(new TextDecoder().decode(await context.fs.readFile(path))) as JsonValue;
  } catch {
    document = null;
  }
  if (document === null) {
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

  const hooks = readHooks(document);
  const matchers = [...hooks.values()]
    .flat()
    .map((entry) => entry.matcher)
    .filter((matcher): matcher is string => matcher !== null);

  return {
    declaration,
    path,
    exists: true,
    parsed: true,
    configuredPoints: [...hooks.keys()],
    matchers: [...new Set(matchers)],
    commands: [...new Set([...hooks.values()].flat().flatMap((entry) => entry.commands))],
  };
}

/**
 * A matcher covers a family when it names it.
 *
 * Claude Code matchers are regular expressions in practice — the spike machine carried a
 * bare `Bash`, and HarnessTrim writes `^Bash$` on Codex — so both an exact name and an
 * anchored pattern have to count. Anything this function cannot interpret is treated as
 * *not* covering, so an unreadable matcher understates coverage rather than overstating
 * it. RFC 0005 exists to stop savings being overstated, and coverage is the input to it.
 */
export function matcherCoversFamily(matcher: string, familyId: string): boolean {
  const stripped = matcher.replace(/^\^/, '').replace(/\$$/, '');
  if (stripped === familyId) return true;
  try {
    return new RegExp(matcher).test(familyId);
  } catch {
    return false;
  }
}

async function detectVersion(
  context: HarnessContext,
): Promise<{ version: string | null; verdict: VersionVerdict | null; evidence: Evidence[] }> {
  const command = MANIFEST.versionCommand;
  if (command === null) return { version: null, verdict: null, evidence: [] };

  const outcome = await context.runner.run({
    executable: command.executable,
    args: [...command.args],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });

  if (outcome.failure !== null) {
    return {
      version: null,
      verdict: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: command.executable,
          detail: `not runnable: ${outcome.failure.reason}`,
        }),
      ],
    };
  }

  const matched = VERSION_PATTERN.exec(outcome.stdout);
  const version = matched?.[1] ?? null;
  if (version === null) {
    return {
      version: null,
      verdict: null,
      evidence: [
        evidence({
          kind: 'version-output',
          source: command.executable,
          detail: 'reported no recognisable semantic version',
        }),
      ],
    };
  }

  return {
    version,
    verdict: classifyVersion(version, MANIFEST.testedVersions),
    evidence: [
      evidence({
        kind: 'version-output',
        source: command.executable,
        path: outcome.executablePath,
        detail: `reported ${version}`,
      }),
    ],
  };
}

/**
 * RFC 0002 §Detection: "Detection must not infer success solely from a configuration
 * string."
 *
 * So `configured` requires both a hook entry *and* a resolvable executable. A settings
 * file with hooks and no executable is `detected` with a warning, which is the honest
 * report of exactly what was seen: someone configured this harness here, and it is not
 * installed on this machine.
 */
async function detect(context: HarnessContext): Promise<HarnessDetection> {
  const evidenceItems: Evidence[] = [];
  const warnings: Diagnostic[] = [];

  const { version, verdict, evidence: versionEvidence } = await detectVersion(context);
  evidenceItems.push(...versionEvidence);

  const configs = await Promise.all(
    MANIFEST.configFiles.map((declaration) => resolveConfig(declaration, context)),
  );
  const present = configs.filter((config) => config.exists);
  const unparsed = present.filter((config) => !config.parsed);
  const configured = present.filter((config) => config.configuredPoints.length > 0);

  for (const config of present) {
    evidenceItems.push(
      evidence({
        kind: 'config-entry',
        source: config.declaration.scope === 'user' ? 'user settings' : 'project settings',
        path: config.path,
        detail: config.parsed
          ? config.configuredPoints.length > 0
            ? `declares ${config.configuredPoints.join(', ')}`
            : 'present with no hook entries'
          : 'present but not valid JSON',
      }),
    );
  }

  for (const config of unparsed) {
    warnings.push(
      diagnostic({
        severity: 'error',
        code: 'harness-config-unreadable',
        message: 'This Claude Code settings file is not valid JSON, so its hooks cannot be read',
        path: config.path,
        remediation: 'Repair the JSON syntax, then run the command again',
      }),
    );
  }

  if (version === null && present.length > 0) {
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-executable-missing',
        message:
          'Claude Code is configured on this machine but its executable could not be run, so the configuration could not be corroborated',
        path: present[0]?.path ?? null,
        remediation: 'Install Claude Code, or remove the settings file if it is no longer used',
      }),
    );
  }

  if (verdict === 'unknown-newer') {
    // RFC 0002 §Harness versioning is symmetric: warn and behave conservatively.
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'harness-version-unknown-newer',
        message: `Claude Code ${String(version)} is newer than the versions whose configuration schema Token Harness has observed (up to ${String(MANIFEST.testedVersions.maximum)})`,
        remediation: 'Check the release notes for hook-schema changes before applying a plan',
      }),
    );
  }

  const state: HarnessState =
    unparsed.length > 0
      ? 'broken'
      : configured.length > 0 && version !== null
        ? 'configured'
        : version !== null || present.length > 0
          ? 'detected'
          : 'absent';

  const primary = present.find((config) => config.declaration.primary) ?? present[0] ?? null;

  return {
    harnessId: CLAUDE,
    state,
    version,
    versionVerdict: verdict,
    configPath: primary?.path ?? null,
    declaredVerificationTier: MANIFEST.verificationTier,
    evidence: evidenceItems,
    warnings,
  };
}

async function inspect(context: HarnessContext): Promise<HarnessInspection> {
  const configs = await Promise.all(
    MANIFEST.configFiles.map((declaration) => resolveConfig(declaration, context)),
  );
  const activeToolFamilies = familiesOnThisPlatform(MANIFEST, context.facts);
  const matchers = configs.flatMap((config) => config.matchers);
  const anyConfigured = configs.some((config) => config.configuredPoints.length > 0);

  const uncoveredToolFamilies = anyConfigured
    ? activeToolFamilies
        .filter((family) => family.executesShellCommands)
        .filter((family) => !matchers.some((matcher) => matcherCoversFamily(matcher, family.id)))
        .map((family) => family.id)
    : [];

  const diagnostics: Diagnostic[] = [];
  if (uncoveredToolFamilies.length > 0) {
    // RFC 0007 §A tier is per harness, per version, and per tool family. Reported as a
    // warning: the integration works for what it covers, and the user has to know it
    // does not cover the rest before reading a savings figure.
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'tool-family-not-covered',
        subject: CLAUDE,
        /**
         * Says whose gap it is, and that the tool is working.
         *
         * The first wording — "No configured matcher covers the PowerShell tool family" — read like a
         * defect in Token Harness on a first run. It is not: the hook in the file below matches some
         * tool families and not others, Claude Code routes shell commands through more than one on
         * Windows, and the commands going through the uncovered ones never reach the provider at all.
         */
        // Short enough to survive the one-line human rendering without being cut.
        message: `${uncoveredToolFamilies.join(', ')} has no hook, so those commands are not optimized`,
        path: configs.find((config) => config.configuredPoints.length > 0)?.path ?? null,
        // Short on purpose: a remediation nobody finishes reading is not one.
        remediation: 'Optional. Widen the matcher, or accept the gap',
      }),
    );
  }

  return {
    harnessId: CLAUDE,
    configs,
    activeToolFamilies,
    uncoveredToolFamilies,
    // The manifest declares no enablement state for this harness: a hook present in
    // settings.json runs. Codex is the one that needs the other answer.
    enabled: MANIFEST.requiresEnablement ? null : null,
    summaries: configs
      .filter((config) => config.configuredPoints.length > 0)
      .map((config) => ({
        harnessId: CLAUDE,
        configPath: config.path,
        scope: config.declaration.scope,
        interceptionPoints: config.configuredPoints,
        matchers: config.matchers,
        commands: config.commands,
      })),
    diagnostics,
  };
}

/**
 * Verification at the declared tier, per RFC 0007.
 *
 * The canary check is `not-exercised`, not `pass` and not `fail`. Claude Code exposes no
 * machine-readable event stream this adapter can read, so the receipt is the provider's,
 * and no provider adapter exists yet. Reporting `pass` here would assert interception on
 * no evidence; reporting `fail` would claim something is broken when nothing is known.
 */
async function verify(context: HarnessContext): Promise<HarnessVerification> {
  const detection = await detect(context);
  const inspection = await inspect(context);
  const checks: VerificationCheck[] = [];

  checks.push({
    id: 'executable-resolves',
    status: detection.version === null ? 'fail' : 'pass',
    summary:
      detection.version === null ? 'claude could not be run' : `Claude Code ${detection.version}`,
    achievedTier: detection.version === null ? null : 'presence',
    evidence: detection.evidence.filter((item) => item.kind === 'version-output'),
    remediation: detection.version === null ? 'Install Claude Code, or add it to PATH' : null,
  });

  const readable = inspection.configs.filter((config) => config.exists && config.parsed);
  const unreadable = inspection.configs.filter((config) => config.exists && !config.parsed);
  checks.push({
    id: 'settings-readable',
    status: unreadable.length > 0 ? 'fail' : readable.length > 0 ? 'pass' : 'not-exercised',
    summary:
      unreadable.length > 0
        ? `${String(unreadable.length)} settings file could not be parsed`
        : readable.length > 0
          ? `${String(readable.length)} settings file read`
          : 'no settings file exists yet',
    achievedTier: null,
    evidence: detection.evidence.filter((item) => item.kind === 'config-entry'),
    remediation: unreadable.length > 0 ? 'Repair the JSON syntax' : null,
  });

  const configured = inspection.configs.filter((config) => config.configuredPoints.length > 0);
  checks.push({
    id: 'hook-registered',
    status: configured.length > 0 ? 'pass' : 'not-exercised',
    summary:
      configured.length > 0
        ? `${configured[0]?.configuredPoints.join(', ') ?? ''} declared`
        : 'no hook entry is declared',
    achievedTier: configured.length > 0 ? 'config-only' : null,
    evidence: [],
    remediation: null,
  });

  checks.push({
    id: 'tool-families-covered',
    status: inspection.uncoveredToolFamilies.length === 0 ? 'pass' : 'fail',
    summary:
      inspection.uncoveredToolFamilies.length === 0
        ? `${inspection.activeToolFamilies.map((family) => family.id).join(', ')} covered`
        : `${inspection.uncoveredToolFamilies.join(', ')} not covered`,
    achievedTier: null,
    evidence: [],
    remediation:
      inspection.uncoveredToolFamilies.length > 0
        ? 'Widen the matcher to cover every shell-executing tool family'
        : null,
  });

  checks.push({
    id: 'canary-intercepted',
    status: 'not-exercised',
    // Worded for what this adapter can and cannot see, because the alternative reads as a
    // contradiction. RFC 0007 puts Claude Code in the `provider-telemetry` receipt family: the
    // harness emits no event stream of its own, so *this* adapter can never witness interception,
    // while a provider's own records can and do. Printed beside `rtk … 290 commands intercepted`,
    // "no receipt has been observed" looked like a disagreement about the same fact.
    summary: 'this harness emits no event stream, so only a provider can witness interception',
    achievedTier: null,
    evidence: [],
    remediation: null,
  });

  const achievedTier = checks.some((check) => check.achievedTier === 'config-only')
    ? 'config-only'
    : checks.some((check) => check.achievedTier === 'presence')
      ? 'presence'
      : null;

  return { harnessId: CLAUDE, declaredTier: MANIFEST.verificationTier, achievedTier, checks };
}

function claudeMcpStatus(text: string): string | null {
  const normalized = text.toLowerCase();
  if (normalized.includes('connected')) return 'connected';
  if (
    normalized.includes('needs authentication') ||
    normalized.includes('authentication required')
  ) {
    return 'authenticationRequired';
  }
  if (normalized.includes('failed') || normalized.includes('error')) return 'failed';
  if (normalized.includes('disabled')) return 'disabled';
  return text.trim() === '' ? null : text.trim();
}

async function observeContext(
  context: HarnessContext,
  _observedAt: string,
): Promise<HarnessContextObservation> {
  const outcome = await context.runner.run({
    executable: 'claude',
    args: ['mcp', 'list'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
    maxOutputBytes: 1024 * 1024,
  });

  const empty = (
    state: HarnessContextObservation['state'],
    diagnostics: Diagnostic[],
  ): HarnessContextObservation => ({
    harnessId: CLAUDE,
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
    mcpServers: [],
    mcpInventoryTruncated: false,
    diagnostics,
  });

  if (outcome.failure !== null) {
    return empty(outcome.failure.reason === 'executable-not-found' ? 'absent' : 'unavailable', [
      diagnostic({
        severity: 'warning',
        code: 'claude-mcp-inventory-unavailable',
        subject: CLAUDE,
        message: 'Claude MCP inventory could not be read: ' + outcome.failure.message,
        remediation: 'Run claude mcp list directly and verify the CLI installation',
      }),
    ]);
  }

  if (outcome.exitCode !== 0) {
    return empty('unavailable', [
      diagnostic({
        severity: 'warning',
        code: 'claude-mcp-inventory-unavailable',
        subject: CLAUDE,
        message: 'claude mcp list exited ' + String(outcome.exitCode),
        remediation: 'Run claude mcp list directly and fix the reported MCP configuration',
      }),
    ]);
  }

  const servers: HarnessContextObservation['mcpServers'] = [];
  for (const line of outcome.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || /^checking\b/i.test(trimmed)) continue;
    const match = /^([^:]+):\s+.*?\s+-\s+(.+)$/.exec(trimmed);
    if (match === null) continue;
    const name = match[1]?.trim();
    if (name === undefined || name === '') continue;
    servers.push({
      harnessId: CLAUDE,
      name,
      toolCount: null,
      runtimeStatus: claudeMcpStatus(match[2] ?? ''),
      authStatus: null,
      pluginId: null,
      source: 'native-cli',
    });
  }

  return {
    ...empty('observed', []),
    mcpServers: servers,
  };
}

export const claudeAdapter: HarnessAdapter = {
  manifest: MANIFEST,
  detect,
  inspect,
  verify,
  observeContext,
};

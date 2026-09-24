/**
 * RTK — PLAN §10, RFC 0005 metrics, and RFC 0007 verification.
 *
 * RTK's shared history rows contain no coding-agent identity. Token Harness therefore keeps
 * those old rows `unknown` and routes new Claude Code and Codex command rewrites to separate
 * RTK databases through its hook proxy. Metrics and passive verification read those databases
 * by harness, never RTK's mixed daily aggregate. The proxy preserves RTK's own rewrite and
 * command-safety behavior; it only selects the database used to record the command.
 */

import {
  classifyVersion,
  diagnostic,
  evidence,
  harnessId,
  MANIFEST_SCHEMA_VERSION,
  numberAt,
  OPTIMIZATION_EVENT_SCHEMA_VERSION,
  providerId,
  stringAt,
  UNATTRIBUTED_PROJECT_ID,
  type Diagnostic,
  type Evidence,
  type HarnessId,
  type ImportCursor,
  type LocalDatabaseRow,
  type MetricsStore,
  type OptimizationEvent,
  type ProviderDetection,
  type ProviderManifest,
  type ProviderPlan,
  type ProviderState,
  type VerificationCheck,
  type VersionVerdict,
} from '@token-harness/core';

import type {
  MetricsImport,
  PassiveReceipt,
  ProviderAdapter,
  ProviderContext,
  ProviderPlanRequest,
  ProviderVerification,
} from './contract.js';
import { buildRtkPlan } from './rtk-plan.js';

const RTK = providerId('rtk');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const OPENCODE = harnessId('opencode');
const TRACKED_HARNESSES = [CLAUDE, CODEX] as const;
const RTK_CODEX_HOOK_VERSION = '0.50.0';

/**
 * The tested range is observation-backed. RTK 0.44.0 and 0.48.0 were exercised with real
 * Windows binaries against Claude Code 2.1.251, including the analytics JSON contract and
 * native Bash/PowerShell hook path. Older RTK builds remain detectable but are deliberately
 * outside the current tested range rather than inheriting PowerShell support by assumption.
 */
const MANIFEST: ProviderManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: RTK,
  displayName: 'RTK',
  description: 'Rust Token Killer: a CLI proxy that filters and summarises command output.',
  homepage: 'https://github.com/rtk-ai/rtk',
  sourceRepository: 'https://github.com/rtk-ai/rtk',
  license: { spdx: null, distributionMode: 'external', reviewRequired: false },
  capabilities: [
    {
      capability: 'shell.command.rewrite',
      mode: 'exclusive',
      harnesses: [CLAUDE],
      // The portable resolver surface remains Bash. Windows PowerShell coverage is added by
      // the planner only on Windows, because ProviderManifest capabilities are not platform-scoped.
      // The native processor and that Windows-only plan path are covered by the live fixture below.
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'pre-tool-use' }],
      evidence: {
        sourceReference: 'tests/fixtures/rows/rtk-claude-windows-2.1.251-0.48.0/README.md',
        upstreamVersion: '0.48.0',
      },
    },
    {
      capability: 'shell.output.reduce',
      mode: 'exclusive',
      harnesses: [CLAUDE],
      // Same portable Bash surface. On Windows the planner adds PowerShell as a platform-only
      // companion matcher; the live fixture below proves the same native processor handles both.
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'pre-tool-use' }],
      evidence: {
        sourceReference: 'tests/fixtures/rows/rtk-claude-windows-2.1.251-0.48.0/README.md',
        upstreamVersion: '0.48.0',
      },
    },
    /**
     * Codex, from RTK 0.50.0's native hook contract.
     *
     * RTK exposes the same pre-execution command-rewrite model through `rtk hook codex`, with a
     * Bash matcher stored in Codex hooks.json. Token Harness writes only that reviewed hook entry;
     * it does not run `rtk init`, touch AGENTS.md/RTK.md, or change Codex sandbox/approval policy.
     */
    {
      capability: 'shell.command.rewrite',
      mode: 'exclusive',
      harnesses: [CODEX],
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'pre-tool-use' }],
      evidence: {
        sourceReference: 'docs/spikes/rtk-codex-upstream-contract.md',
        upstreamVersion: '0.50.0',
      },
    },
    {
      capability: 'shell.output.reduce',
      mode: 'exclusive',
      harnesses: [CODEX],
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'pre-tool-use' }],
      evidence: {
        sourceReference: 'docs/spikes/rtk-codex-upstream-contract.md',
        upstreamVersion: '0.50.0',
      },
    },
    /**
     * OpenCode, from spike 9.1.
     *
     * Separate entries rather than adding `OPENCODE` to the two above, because the surface is not
     * the same one: RTK reaches Claude Code through a `PreToolUse` hook matching `Bash`, and
     * OpenCode through a plugin on `tool.execute.before`. A capability entry names one surface
     * list, and merging these would claim that RTK serves `Bash/pre-tool-use` on OpenCode — a
     * point OpenCode does not have.
     *
     * `shell.command.rewrite` and `shell.output.reduce` again arrive together, for the reason they
     * do on Claude Code: the plugin calls `rtk rewrite`, and the rewritten command is what filters
     * its own output. One interception point, two capabilities.
     */
    {
      capability: 'shell.command.rewrite',
      mode: 'exclusive',
      harnesses: [OPENCODE],
      // `tool.execute` is the family the harness manifest declares as shell-executing. The plugin
      // narrows to `tool === "bash" || tool === "shell"` inside that family, which is every shell
      // route OpenCode exposes — unlike Claude Code on Windows, there is no second one to miss.
      surfaces: [{ toolFamily: 'tool.execute', interceptionPoint: 'tool-execute-before' }],
      evidence: {
        sourceReference: 'docs/spikes/9.1-rtk-opencode-observation-log.md',
        upstreamVersion: '0.44.0',
      },
    },
    {
      capability: 'shell.output.reduce',
      mode: 'exclusive',
      harnesses: [OPENCODE],
      surfaces: [{ toolFamily: 'tool.execute', interceptionPoint: 'tool-execute-before' }],
      evidence: {
        sourceReference: 'docs/spikes/9.1-rtk-opencode-observation-log.md',
        upstreamVersion: '0.44.0',
      },
    },
  ],
  platforms: [
    {
      os: 'windows',
      wsl: false,
      supported: true,
      // Spike 9.1. Named on Windows alone because Windows is where Desktop was run; the same
      // defect on another platform's Desktop build would be a guess until someone watches it.
      limitation:
        "RTK's OpenCode plugin is inert under OpenCode Desktop, which supplies no `$` shell helper to plugins, so the plugin's own guard disables it silently",
    },
    { os: 'linux', wsl: true, supported: true, limitation: null },
    { os: 'macos', wsl: false, supported: true, limitation: null },
    { os: 'linux', wsl: false, supported: true, limitation: null },
  ],
  harnesses: [
    {
      harness: CLAUDE,
      testedVersions: { minimum: '2.0.0', maximum: '2.1.251' },
      verificationTier: 'canary',
    },
    {
      harness: CODEX,
      // RTK added its native Codex PreToolUse rewriter in 0.50.0. Earlier releases only wrote
      // prompt instructions; a hooks.json entry alone did not activate it.
      testedVersions: { minimum: '0.146.0', maximum: '0.146.0' },
      verificationTier: 'canary',
    },
    {
      harness: OPENCODE,
      // Spike 9.1 watched interception on the CLI at `1.18.11` and watched it fail on Desktop at
      // `1.18.14`. The range covers both because both were observed; the failure is a declared
      // platform limitation below rather than a narrower range, because it is a property of the
      // host application and not of the OpenCode version — the same 1.18.x plugin loads in both.
      testedVersions: { minimum: '1.18.11', maximum: '1.18.14' },
      /** OpenCode still writes to RTK's shared database and has no managed attribution wrapper. */
      verificationTier: 'config-only',
    },
  ],
  installationChannels: [
    {
      id: 'winget',
      // Verified on a real machine: `rtk` resolves to
      // `WinGet/Packages/rtk-ai.rtk_Microsoft.Winget.Source_.../rtk.exe`, and `winget search rtk`
      // returns the id `rtk-ai.rtk`. Installing `--id rtk` would match nothing.
      packageId: 'rtk-ai.rtk',
      kind: 'github-release',
      priority: 0,
      platforms: ['windows'],
      requiresNetwork: true,
      requiresElevation: false,
      digestAvailable: true,
    },
    {
      id: 'cargo',
      // The crate name, which is not the winget id. Unverified: cargo is not installed on the
      // machine this was checked against, and `install.ts` reports that at run time rather than
      // implying the invocation was observed working.
      packageId: 'rtk',
      kind: 'cargo',
      priority: 1,
      platforms: ['windows', 'macos', 'linux'],
      requiresNetwork: true,
      requiresElevation: false,
      digestAvailable: false,
    },
  ],
  metrics: {
    // Amended with RFC 0005 §Importers §RTK. The CLI's JSON is an aggregate and cannot
    // carry a per-operation event; the history database can, and `local-database` was
    // already a member of this union. The CLI analytics keep their other job — the passive
    // verification receipt in `verify` below.
    source: 'local-database',
    mode: 'native',
    // Resolved from the platform data directory rather than stated absolutely, because the
    // location differs per platform; `rtkDatabasePath` is the single derivation.
    locations: [
      '<user data directory>/rtk/history.db',
      '<Token Harness state directory>/rtk-claude.db',
      '<Token Harness state directory>/rtk-codex.db',
    ],
  },
  delegatedInstallReviews: null,
};

const TESTED_VERSIONS = { minimum: '0.44.0', maximum: '0.50.0' };
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

/** The token that identifies an RTK hook command, per the shape the spike observed. */
const HOOK_COMMAND_PATTERN = /(^|[\\/\s"'])rtk(\.exe)?([\s"']|$)/i;

/**
 * The plugin module `rtk init -g --opencode` writes.
 *
 * A second pattern rather than a looser first one, because these recognise different things. A
 * hook command is a command line, and `rtk` in it is an executable being invoked. What OpenCode
 * reports is a *file path*, and `rtk.ts` is a module name — `HOOK_COMMAND_PATTERN` does not match
 * it and should not, or any path merely containing an `rtk` directory would start claiming to be
 * an installation.
 *
 * Anchored at the end so it matches the file and not a directory of the same name, and the
 * suffixes are the ones OpenCode auto-loads. Spike 9.1 observed the file at
 * `.config/opencode/plugins/rtk.ts`; the installer refuses to write it anywhere project-local.
 */
const PLUGIN_MODULE_PATTERN = /(^|[\\/])rtk\.(ts|js|mjs|cjs|mts|cts)$/i;

/** Harnesses whose configuration names RTK, as a hook command or as an installed plugin module. */
export function harnessesWiredToRtk(
  configs: readonly ProviderContext['harnessConfigs'][number][],
): HarnessId[] {
  const wired = new Set<HarnessId>();
  for (const config of configs) {
    if (config.commands.some((command) => identifiesCommand(command))) {
      wired.add(config.harnessId);
    }
  }
  return [...wired];
}

async function readVersion(context: ProviderContext): Promise<{
  version: string | null;
  verdict: VersionVerdict | null;
  executable: string | null;
  evidence: Evidence[];
}> {
  const outcome = await context.runner.run({
    executable: 'rtk',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });

  if (outcome.failure !== null) {
    return {
      version: null,
      verdict: null,
      executable: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: 'rtk',
          detail: `not runnable: ${outcome.failure.reason}`,
        }),
      ],
    };
  }

  const version = VERSION_PATTERN.exec(outcome.stdout)?.[1] ?? null;
  return {
    version,
    verdict: version === null ? null : classifyVersion(version, TESTED_VERSIONS),
    executable: outcome.executablePath,
    evidence: [
      evidence({
        kind: 'version-output',
        source: 'rtk --version',
        path: outcome.executablePath,
        detail: version === null ? 'reported no recognisable version' : `reported ${version}`,
      }),
    ],
  };
}

const HARNESS_ACTIVITY_QUERY =
  'SELECT COUNT(*) AS operation_count, MAX(timestamp) AS latest_timestamp FROM commands';

interface RtkHarnessActivity {
  count: number;
  latestTimestamp: string | null;
  failure: string | null;
}

async function readHarnessActivity(
  context: ProviderContext,
  harness: HarnessId,
): Promise<RtkHarnessActivity> {
  if (context.localDatabase === null) {
    return { count: 0, latestTimestamp: null, failure: 'database reader unavailable' };
  }
  const path = rtkHarnessDatabasePath(context, harness);
  const result = await context.localDatabase.query({
    path,
    sql: HARNESS_ACTIVITY_QUERY,
    parameters: [],
  });
  if (result.failure !== null) {
    return {
      count: 0,
      latestTimestamp: null,
      failure: result.failure === 'not-found' ? null : result.failure,
    };
  }
  const row = result.rows[0];
  return {
    count: row === undefined ? 0 : (numberAt(row, 'operation_count') ?? 0),
    latestTimestamp: row === undefined ? null : stringAt(row, 'latest_timestamp'),
    failure: null,
  };
}

function hasAttributionHook(context: ProviderContext, harness: HarnessId): boolean {
  const command = new RegExp(
    `^token-harness __internal-rtk-hook ${harness}(?: --restore-rtk)?$`,
    'i',
  );
  return context.harnessConfigs.some(
    (config) =>
      config.harnessId === harness && config.commands.some((entry) => command.test(entry.trim())),
  );
}

async function detect(context: ProviderContext): Promise<ProviderDetection> {
  const evidenceItems: Evidence[] = [];
  const warnings: Diagnostic[] = [];

  const version = await readVersion(context);
  evidenceItems.push(...version.evidence);

  const configured = harnessesWiredToRtk(context.harnessConfigs);
  for (const harness of configured) {
    evidenceItems.push(
      evidence({
        kind: 'config-entry',
        source: `${harness} hook`,
        path:
          context.harnessConfigs.find((config) => config.harnessId === harness)?.configPath ?? null,
        detail: 'names rtk in a hook command',
      }),
    );
  }

  if (version.verdict === 'unknown-newer') {
    warnings.push(
      diagnostic({
        severity: 'warning',
        code: 'provider-version-unknown-newer',
        message: `RTK ${String(version.version)} is newer than the versions Token Harness has observed (up to ${TESTED_VERSIONS.maximum})`,
        remediation: 'Check the release notes for analytics or hook changes before applying a plan',
      }),
    );
  }

  const codexHookSupported = version.version === RTK_CODEX_HOOK_VERSION;
  const codexConfiguredWithoutHookSupport = configured.includes(CODEX) && !codexHookSupported;
  if (codexConfiguredWithoutHookSupport) {
    warnings.push(
      diagnostic({
        severity: 'error',
        code: 'rtk-codex-hook-unsupported',
        subject: CODEX,
        message: `RTK ${String(version.version)} does not provide the Codex hook; its configuration entry cannot capture commands`,
        remediation: `Upgrade RTK to ${RTK_CODEX_HOOK_VERSION}, then refresh and apply the attribution plan`,
      }),
    );
  }

  // RFC 0002 §Detection: never infer from a configuration string alone. A harness wired to
  // rtk with no runnable rtk is `broken` — the integration is present and cannot work.
  const state: ProviderState =
    version.version === null
      ? configured.length > 0
        ? 'broken'
        : 'absent'
      : codexConfiguredWithoutHookSupport && configured.length === 1
        ? 'broken'
        : configured.length > 0
          ? 'configured'
          : 'installed';

  if (state === 'broken' && version.version === null) {
    warnings.push(
      diagnostic({
        severity: 'error',
        code: 'provider-configured-but-missing',
        message:
          'A harness hook on this machine invokes rtk, but rtk could not be run, so every intercepted command will fail',
        path: context.harnessConfigs[0]?.configPath ?? null,
        remediation: 'Install RTK, or remove the hook entry that invokes it',
      }),
    );
  }

  return {
    providerId: RTK,
    state,
    version: version.version,
    executable: version.executable,
    // Detection reports what it saw; which channel installed it is an installation-stage
    // question and guessing it from a path would be a guess.
    installationChannel: null,
    versionVerdict: version.verdict,
    configuredHarnesses: configured,
    unmanagedHarnessesConfigured: [],
    /**
     * RFC 0002 §Providers may exceed the managed surface.
     *
     * The field asks whether this manifest names a harness with no adapter behind it. It names
     * Claude Code, Codex and OpenCode, and all are managed — so the qualifier RFC 0006's doctor transcript
     * uses for HarnessTrim does not apply, and the report says "not configured for any harness"
     * without hedging.
     *
     * `rtk init --agent` separately targets Cursor, Windsurf, Cline, Kilo Code, Antigravity, Kimi,
     * Pi, Hermes, and Droid. That is RTK exceeding *Token Harness*, not this manifest exceeding the
     * managed set, and it stays out of the flag: claiming those here would make the resolver
     * responsible for harnesses this build has no adapter to inspect.
     */
    supportsUnmanagedHarnesses: false,
    // RFC 0004 §Brownfield adoption: nothing has been applied by Token Harness yet, so
    // every installation it finds is the user's.
    managedByTokenHarness: false,
    /**
     * Assignment follows the harness-declared command-hook surface. Claude Code and Codex both
     * expose the reviewed hooks-event command-list contract, so this build can produce their RTK
     * configuration transactionally. OpenCode remains detectable/verifiable but not assignable:
     * its integration is a plugin module installed by `rtk init -g --opencode`, which this build
     * deliberately does not delegate without a reviewed write set.
     */
    assignableHarnesses:
      version.version === null || codexHookSupported ? [CLAUDE, CODEX] : [CLAUDE],
    evidence: evidenceItems,
    warnings,
  };
}

/** Verification uses only isolated per-harness command history; shared history proves no agent. */
async function verify(context: ProviderContext): Promise<ProviderVerification> {
  const checks: VerificationCheck[] = [];
  const diagnostics: Diagnostic[] = [];

  const version = await readVersion(context);
  checks.push({
    id: 'executable-resolves',
    status: version.version === null ? 'fail' : 'pass',
    summary: version.version === null ? 'rtk could not be run' : `rtk ${version.version}`,
    achievedTier: version.version === null ? null : 'presence',
    evidence: version.evidence,
    remediation: version.version === null ? 'Install RTK, or add it to PATH' : null,
  });

  const configured = harnessesWiredToRtk(context.harnessConfigs);
  const configuredSupported = configured.filter(
    (harness) =>
      harness === CLAUDE || (harness === CODEX && version.version === RTK_CODEX_HOOK_VERSION),
  );
  checks.push({
    id: 'hook-registered',
    status:
      configuredSupported.length > 0 ? 'pass' : configured.length > 0 ? 'fail' : 'not-exercised',
    summary:
      configuredSupported.length > 0
        ? `wired to ${configuredSupported.join(', ')}`
        : configured.length > 0
          ? `RTK ${String(version.version)} cannot run its Codex hook`
          : 'no harness configuration names rtk',
    achievedTier: configuredSupported.length > 0 ? 'config-only' : null,
    evidence: [],
    remediation:
      configured.length > 0 && configuredSupported.length === 0
        ? `Upgrade RTK to ${RTK_CODEX_HOOK_VERSION} for Codex hook support`
        : null,
  });

  let receipt: PassiveReceipt | null = null;
  let bestReceiptTime = Number.NEGATIVE_INFINITY;

  for (const harness of TRACKED_HARNESSES) {
    if (!configured.includes(harness)) continue;
    const label = harness === CLAUDE ? 'Claude Code' : 'Codex';
    const supported = harness !== CODEX || version.version === RTK_CODEX_HOOK_VERSION;
    if (!supported) {
      checks.push({
        id: `rtk-attribution-${harness}`,
        status: 'fail',
        summary: `RTK ${String(version.version)} does not provide an active ${label} hook`,
        achievedTier: null,
        evidence: [],
        remediation: `Upgrade RTK to ${RTK_CODEX_HOOK_VERSION}, then refresh and apply the tracking update`,
      });
      continue;
    }

    if (!hasAttributionHook(context, harness)) {
      checks.push({
        id: `rtk-attribution-${harness}`,
        status: 'not-exercised',
        summary: `${label} uses RTK's shared history, which cannot be assigned to one agent`,
        achievedTier: null,
        evidence: [],
        remediation: 'Apply the reviewed per-agent tracking update in Token Harness',
      });
      continue;
    }

    const activity = await readHarnessActivity(context, harness);
    const path = rtkHarnessDatabasePath(context, harness);
    if (activity.failure !== null) {
      checks.push({
        id: `rtk-attribution-${harness}`,
        status: 'fail',
        summary: `${label}'s RTK-specific history could not be read (${activity.failure})`,
        achievedTier: null,
        evidence: [
          evidence({
            kind: 'absence',
            source: 'RTK per-agent history',
            detail: activity.failure,
            path,
          }),
        ],
        remediation: 'Check that Token Harness can read its private data directory',
      });
      continue;
    }
    if (activity.count === 0 || activity.latestTimestamp === null) {
      checks.push({
        id: `rtk-attribution-${harness}`,
        status: 'not-exercised',
        summary: `no RTK command has been recorded for ${label} since per-agent tracking was enabled`,
        achievedTier: null,
        evidence: [
          evidence({
            kind: 'absence',
            source: 'RTK per-agent history',
            detail: 'No commands recorded since per-agent tracking was enabled',
            path,
          }),
        ],
        remediation: `Run a shell command through ${label}, then refresh Results`,
      });
      continue;
    }

    const instant = new Date(activity.latestTimestamp);
    if (Number.isNaN(instant.getTime())) {
      checks.push({
        id: `rtk-attribution-${harness}`,
        status: 'fail',
        summary: `${label}'s RTK history contains an invalid timestamp`,
        achievedTier: null,
        evidence: [
          evidence({
            kind: 'absence',
            source: 'RTK per-agent history',
            detail: 'RTK history timestamp could not be parsed',
            path,
          }),
        ],
        remediation: 'Check whether RTK changed its history schema',
      });
      continue;
    }

    const observedAt = instant.toISOString();
    checks.push({
      id: `rtk-attribution-${harness}`,
      status: 'pass',
      summary: `${String(activity.count)} RTK commands recorded for ${label}`,
      achievedTier: 'canary',
      evidence: [
        evidence({
          kind: 'provider-doctor',
          source: 'RTK per-agent history',
          path,
          detail: `${String(activity.count)} operations; latest ${observedAt}`,
        }),
      ],
      remediation: null,
    });
    const observedTime = instant.getTime();
    if (observedTime > bestReceiptTime) {
      bestReceiptTime = observedTime;
      receipt = {
        observedAt,
        operations: activity.count,
        source: `RTK per-agent history (${harness})`,
        harnessId: harness,
      };
    }

    const ageDays = receiptAgeInDays(observedAt.slice(0, 10), context);
    if (ageDays !== null && ageDays > STALE_RECEIPT_DAYS) {
      checks.push({
        id: `receipt-freshness-${harness}`,
        status: 'info',
        summary: `the latest ${label} command was ${String(ageDays)} days ago`,
        achievedTier: null,
        evidence: [],
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
    providerId: RTK,
    declaredTier: 'canary',
    achievedTier,
    receipt,
    checks,
    diagnostics,
  };
}

/** A week. Long enough that ordinary weekends do not trip it. */
const STALE_RECEIPT_DAYS = 7;

/**
 * Age of a `YYYY-MM-DD` receipt in whole days.
 *
 * The clock comes from the platform facts rather than from `Date.now()` so a test can
 * assert staleness without waiting a week. Null when the date is unparseable, which is
 * reported as no freshness information rather than as a stale receipt.
 */
function receiptAgeInDays(date: string, context: ProviderContext): number | null {
  const observed = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(context.now());
  if (Number.isNaN(observed) || Number.isNaN(now)) return null;
  return Math.floor((now - observed) / 86_400_000);
}

/**
 * ## Metrics: the per-operation source, and why it is not the one RFC 0005 named
 *
 * RFC 0005 §Importers §RTK originally named `rtk gain --all --format json` as the metrics
 * source. On a real machine it cannot produce an `OptimizationEvent`, and the reasons are
 * recorded in the RFC amendment rather than only here:
 *
 * - the finest machine-readable grain the CLI offers is a *daily aggregate*. `--history`
 *   silently ignores `--format json` (returning only `summary`) and returns zero bytes for
 *   `--format csv`; in text mode it aggregates by command family. There is no per-operation
 *   output in any format;
 * - that aggregate mutates. Two invocations one minute apart reported
 *   `daily[2026-07-31] = 11 commands / 165 saved` and then `13 / 170`. RFC 0005's dedup
 *   model — restart from zero and "discard what it already has" — was written for an
 *   append-only file where a past line never changes. Against a mutable aggregate,
 *   discarding freezes the day at its first observed value and understates savings for
 *   good; not discarding double-counts;
 * - `ImportCursor`'s file-shaped members have no meaning for a CLI invocation.
 *
 * `%LOCALAPPDATA%\rtk\history.db` holds one immutable row per intercepted command, with a
 * monotonic `id`. That makes dedup native rather than synthesized, and it makes one figure
 * expressible that the aggregate cannot: on the machine this was written against, 2,132 of
 * 2,828 intercepted commands saved *zero* tokens. The daily aggregate reports 9.5% average
 * savings and cannot say that three quarters of interceptions moved nothing. RFC 0005 wants
 * `outcome.changed` precisely so coverage and bypass metrics stay correct, and only the
 * per-operation source can set it.
 *
 * The daily aggregate is not used for savings or verification because it does not identify
 * which harness produced a command. Only the separated history databases can provide an
 * agent-attributed receipt.
 *
 * ### What is deliberately not read
 *
 * The `commands` table has `original_cmd` and `rtk_cmd` columns holding raw command text.
 * RFC 0005 §Privacy: "Raw command text, raw tool output, source code, file paths, prompts,
 * and credentials are not part of the normalized event." The statement below names its
 * columns explicitly and neither appears; a `SELECT *` here would be a privacy regression
 * that no type would catch.
 */

/** RTK's own token counts, per row. Columns chosen so raw command text is never selected. */
const HISTORY_QUERY =
  'SELECT id, timestamp, input_tokens, output_tokens, saved_tokens, exec_time_ms, project_path ' +
  'FROM commands WHERE id > ? ORDER BY id LIMIT ?';

/** The lowest surviving row identifier, used as the generation marker. See `cursorGeneration`. */
const GENERATION_QUERY = 'SELECT MIN(id) AS low, MAX(id) AS high FROM commands';

/**
 * Rows per import.
 *
 * A bound rather than a stream because the child returns one JSON document, and an
 * unbounded first import on a long-lived installation would build a large one in memory on
 * both sides. Successive imports advance the cursor, so a backlog drains over a few runs
 * rather than being lost.
 */
const IMPORT_BATCH_SIZE = 5_000;

/**
 * Where RTK keeps its history database.
 *
 * Derived from Token Harness's own data directory rather than hardcoded, because both tools
 * follow the same platform convention: the parent of `paths.data` is the per-user data root
 * (`%LOCALAPPDATA%`, `~/Library/Application Support`, `~/.local/share`), and RTK's directory
 * is a sibling of ours inside it.
 *
 * Only the Windows location has been confirmed against an installed RTK. The other two are
 * the convention's prediction, which is why a miss is reported as `not-found` — an ordinary
 * absence — rather than as a defect.
 */
export function rtkDatabasePath(context: ProviderContext): string {
  const dataRoot = context.fs.dirname(context.paths.data);
  return context.fs.join(dataRoot, 'rtk', 'history.db');
}

/** The isolated RTK history file written by Token Harness's attribution hook. */
export function rtkHarnessDatabasePath(context: ProviderContext, harness: HarnessId): string {
  if (harness !== 'claude' && harness !== 'codex') {
    throw new Error(`RTK per-agent history is not supported for ${harness}`);
  }
  return context.fs.join(context.paths.state, `rtk-${harness}.db`);
}

/**
 * The cursor's `fileIdentity` for this source.
 *
 * RFC 0005 wanted the digest to confirm "the file was appended to rather than rewritten".
 * The analogue for this table is its lowest surviving identifier: `rtk gain --reset` empties
 * it, and a re-populated table starts again from a low `id`. If that marker changes, rows
 * this cursor claims to have imported are not the rows now in the table, and the import
 * restarts.
 *
 * It is deliberately *only* `MIN(id)`. My first version included the row count, which
 * changes on every intercepted command — so every run looked like a reset, restarted from
 * zero, and re-imported the whole table. The report doubled its figures on the second run,
 * which is how I found it. A generation marker has to be invariant under the thing it is
 * meant to tolerate.
 *
 * A reset that happens to leave the same `MIN(id)` is still caught, by the separate check
 * that the table's maximum has not gone backwards past the stored mark.
 */
function cursorGeneration(low: number | null): string {
  return `rtk-history:low=${String(low ?? 0)}`;
}

/**
 * One row becomes one event.
 *
 * `input_tokens` is the raw command output and `output_tokens` is what RTK let through, so
 * the pair is the before/after of a single observed operation — which is what RFC 0005
 * §Exact local requires, and its own example is "RTK command output before and after
 * filtering". `tokenizer: 'rtk'` records that the counts come from RTK's tokenizer rather
 * than the model provider's, so a reader can judge the figure instead of trusting it.
 */
function toEvent(
  row: LocalDatabaseRow,
  context: ProviderContext,
  attributedHarness: HarnessId | 'unknown',
): OptimizationEvent | null {
  const id = numberAt(row, 'id');
  const timestamp = stringAt(row, 'timestamp');
  const before = numberAt(row, 'input_tokens');
  const after = numberAt(row, 'output_tokens');
  if (id === null || timestamp === null || before === null || after === null) return null;

  // RTK stamps a nanosecond-precision offset timestamp; the event schema is ISO 8601.
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return null;

  const projectPath = stringAt(row, 'project_path');

  return {
    schemaVersion: OPTIMIZATION_EVENT_SCHEMA_VERSION,
    // Native, not synthesized: RFC 0005 prefers the upstream identifier when there is one,
    // and this one is a primary key.
    // Preserve legacy shared event identities so an upgrade does not duplicate already imported
    // rows. Isolated per-agent databases can reuse SQLite ids, so their identities are namespaced.
    eventId:
      attributedHarness === 'unknown'
        ? `rtk-history-${String(id)}`
        : `rtk-history-${attributedHarness}-${String(id)}`,
    timestamp: instant.toISOString(),
    provider: { id: RTK, version: null },
    context: {
      // An empty `project_path` means RTK recorded no directory; attributing the event to
      // the directory `metrics` happens to run in would invent an attribution.
      projectId:
        projectPath === null || projectPath === ''
          ? UNATTRIBUTED_PROJECT_ID
          : context.projectIdFor(projectPath),
      // RTK proxies commands for whichever harness invoked it and does not record which.
      // The hook that wires it is per harness, but a *row* carries no harness, and reading
      // one off the current configuration would attribute months of history to today's
      // wiring.
      harnessId: attributedHarness,
      sessionId: null,
      operationId:
        attributedHarness === 'unknown'
          ? `rtk-history-${String(id)}`
          : `rtk-history-${attributedHarness}-${String(id)}`,
      pipelineId: null,
      pipelineOrder: null,
      toolFamily: null,
      // What the token delta measures: the command ran either way, and what shrank was its
      // output.
      capability: 'shell.output.reduce',
    },
    measurement: {
      class: 'exact-local',
      beforeChars: null,
      afterChars: null,
      beforeTokens: before,
      afterTokens: after,
      tokenizer: 'rtk',
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      // RFC 0005 asks whether "the payload the model saw was actually modified", which is
      // not the same question as whether it got smaller.
      //
      // On the machine this was written against, 240 rows have `output_tokens` *greater*
      // than `input_tokens` — 1,957 tokens of inflation in total. RTK modified those
      // payloads; it just made them bigger. Recording them as unchanged would file a real
      // modification as a bypass and hide the inflation from every report.
      //
      // Equal counts are treated as pass-through. RTK does not record whether the text
      // changed, and an identical token count is the strongest evidence available that it
      // did not.
      changed: after !== before,
      bypassReason: after === before ? 'no-reduction-applied' : null,
      originalReference: null,
      // Deliberately null, and `exec_time_ms` is deliberately not used for it.
      //
      // `latencyMs` is the overhead the optimization added — RFC 0006 renders it as "Added
      // median latency". RTK's column is how long the *command* took: `rtk gain` reports the
      // same total as "Total exec time … avg 3.4s", which is the runtime of `git status` and
      // friends, not anything RTK spent. Filing it here would make the report claim RTK adds
      // three and a half seconds to every command it touches.
      //
      // RTK does not record its own overhead, so there is nothing honest to put here.
      latencyMs: null,
      errorCode: null,
    },
    source: { nativeEventId: String(id), importedAt: context.now() },
  };
}

/**
 * RFC 0005 §Importers §RTK, as amended.
 *
 * Two fidelity modes, and the degraded one reports nothing rather than estimating:
 *
 * | Mode | Condition | Consequence |
 * | --- | --- | --- |
 * | `native` | the history database is readable | per-operation `exact-local` events, native dedup |
 * | `unavailable` | no reader, no database, or no driver | no events, and `status` says so |
 *
 * There is no `legacy` mode for this provider. The only other source is the daily
 * aggregate, and RFC 0005 has no honest event for it.
 */
async function collectMetrics(
  context: ProviderContext,
  store: MetricsStore,
): Promise<MetricsImport> {
  if (context.localDatabase === null) {
    return {
      providerId: RTK,
      mode: 'unavailable',
      source: null,
      imported: 0,
      skipped: 0,
      cursor: null,
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'provider-metrics-unavailable',
          message: 'this host supplied no local-database reader, so RTK metrics were not imported',
          path: rtkDatabasePath(context),
          remediation: null,
        }),
      ],
    };
  }

  const sources = [
    { path: rtkDatabasePath(context), harnessId: 'unknown' as const },
    ...TRACKED_HARNESSES.map((harness) => ({
      path: rtkHarnessDatabasePath(context, harness),
      harnessId: harness,
    })),
  ];
  let imported = 0;
  let skipped = 0;
  let cursor: ImportCursor | null = null;
  let cursorSourceCount = 0;
  let readableSources = 0;
  const diagnostics: Diagnostic[] = [];

  // Sequential appends keep each source's cursor and event batch ordered in the shared store.
  for (const source of sources) {
    const result = await importHistorySource(context, store, source.path, source.harnessId);
    imported += result.imported;
    skipped += result.skipped;
    readableSources += result.readable ? 1 : 0;
    if (result.readable && result.cursor !== null) {
      cursorSourceCount += 1;
      cursor = cursorSourceCount === 1 ? result.cursor : null;
    }
    diagnostics.push(...result.diagnostics);
  }

  if (readableSources === 0 && diagnostics.length === 0) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'provider-metrics-unavailable',
        message: 'RTK has not recorded command history for any harness on this machine yet',
        path: rtkDatabasePath(context),
        remediation: null,
      }),
    );
  }

  return {
    providerId: RTK,
    mode: readableSources > 0 ? 'native' : 'unavailable',
    source: readableSources > 0 ? SOURCE_LABEL : null,
    imported,
    skipped,
    // This result can represent the single cursor in a legacy-only import. Once multiple
    // independent databases contribute, their cursors are stored separately and there is no
    // honest aggregate cursor to return in this singular compatibility field.
    cursor: cursorSourceCount === 1 ? cursor : null,
    diagnostics,
  };
}

interface SourceImportResult {
  readable: boolean;
  imported: number;
  skipped: number;
  cursor: ImportCursor | null;
  diagnostics: Diagnostic[];
}

async function importHistorySource(
  context: ProviderContext,
  store: MetricsStore,
  path: string,
  attributedHarness: HarnessId | 'unknown',
): Promise<SourceImportResult> {
  const unavailable = (message: string, remediation: string | null): SourceImportResult => ({
    readable: false,
    imported: 0,
    skipped: 0,
    cursor: null,
    diagnostics:
      message.length === 0
        ? []
        : [
            diagnostic({
              severity: 'info',
              code: 'provider-metrics-unavailable',
              message,
              path,
              remediation,
            }),
          ],
  });
  const localDatabase = context.localDatabase;
  if (localDatabase === null) return unavailable('', null);

  const generation = await localDatabase.query({ path, sql: GENERATION_QUERY, parameters: [] });
  if (generation.failure !== null) {
    if (generation.failure === 'not-found') return unavailable('', null);
    return unavailable(
      `RTK's ${attributedHarness} command history could not be read (${generation.failure})`,
      generation.failure === 'driver-unavailable'
        ? 'Run Token Harness on a Node build that provides node:sqlite'
        : null,
    );
  }

  const first = generation.rows[0];
  const low = first === undefined ? null : numberAt(first, 'low');
  const high = first === undefined ? null : numberAt(first, 'high');
  const identity = cursorGeneration(low);
  const stored = await store.readCursor(RTK, path);
  let from = 0;
  const diagnostics: Diagnostic[] = [];
  if (stored !== null && stored.highWaterMark !== null) {
    const previous = Number(stored.highWaterMark);
    const sameGeneration = stored.fileIdentity === identity && (high === null || high >= previous);
    if (sameGeneration && Number.isFinite(previous)) {
      from = previous;
    } else if (!sameGeneration) {
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'provider-metrics-source-reset',
          message: `RTK's ${attributedHarness} command history was reset and is being read from the start`,
          path,
          remediation: null,
        }),
      );
    }
  }

  if (high !== null && from >= high) {
    return { readable: true, imported: 0, skipped: 0, cursor: stored, diagnostics };
  }

  const batch = await localDatabase.query({
    path,
    sql: HISTORY_QUERY,
    parameters: [from, IMPORT_BATCH_SIZE],
  });
  if (batch.failure !== null) {
    return unavailable(
      `RTK's ${attributedHarness} command history could not be read (${batch.failure})`,
      null,
    );
  }

  const events: OptimizationEvent[] = [];
  let skipped = 0;
  let highest = from;
  for (const row of batch.rows) {
    const id = numberAt(row, 'id');
    if (id !== null && id > highest) highest = id;
    const event = toEvent(row, context, attributedHarness);
    if (event === null) {
      skipped += 1;
      continue;
    }
    events.push(event);
  }

  if (skipped > 0) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'provider-metrics-rows-skipped',
        message: `${String(skipped)} of ${String(batch.rows.length)} RTK history rows were not in a shape this build understands`,
        path,
        remediation: 'Check whether RTK changed its history schema',
      }),
    );
  }

  await store.appendEvents(events);
  const nextCursor: ImportCursor = {
    providerId: RTK,
    sourceId: path,
    absolutePath: path,
    fileIdentity: identity,
    byteOffset: 0,
    lastLineDigest: null,
    highWaterMark: String(highest),
    updatedAt: context.now(),
  };
  await store.writeCursor(nextCursor);

  if (batch.rows.length === IMPORT_BATCH_SIZE) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'provider-metrics-partial-import',
        message: `RTK history is being imported in batches of ${String(IMPORT_BATCH_SIZE)}; run the import again to continue`,
        path,
        remediation: null,
      }),
    );
  }

  return {
    readable: true,
    imported: events.length,
    skipped,
    cursor: nextCursor,
    diagnostics,
  };
}

const SOURCE_LABEL = 'RTK command history databases';

/**
 * Recognises RTK's own invocation, whether it arrives as a hook command or as the path of the
 * plugin module RTK installs.
 *
 * The same patterns `harnessesWiredToRtk` uses, exposed so the conflict detector can ask without
 * knowing what an RTK installation looks like. Both spellings are RTK claiming an interception
 * point, and a detector that saw only the command form would report OpenCode as unowned while RTK
 * was rewriting every shell call on it.
 */
function identifiesCommand(command: string): boolean {
  return (
    HOOK_COMMAND_PATTERN.test(command) ||
    PLUGIN_MODULE_PATTERN.test(command) ||
    /(^|[\\/\s"'])token-harness(?:\.cmd|\.exe)?\s+__internal-rtk-hook(?:\s|$)/i.test(command)
  );
}

/**
 * RFC 0002 §Planning, PLAN §10.
 *
 * The whole body is in `rtk-plan.ts`; what lives here is the one thing the plan needs from
 * this module and cannot get anywhere else — whether `rtk` can actually be run. `detect` is
 * the authority on that, so the plan asks it rather than re-deriving it.
 */
async function plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan> {
  const version = await readVersion(context);
  let hookProxyAvailable = false;
  if (request.desiredState === 'configured' && request.ownership.length > 0) {
    const proxy = await context.runner.run({
      executable: 'token-harness',
      args: ['__internal-rtk-hook', 'claude', '--check'],
      cwd: context.projectRoot,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    });
    hookProxyAvailable =
      proxy.failure === null &&
      proxy.exitCode === 0 &&
      proxy.stdout.trim() === 'token-harness-rtk-hook-proxy-v1';
  }
  return buildRtkPlan({
    context,
    request,
    installed: version.version !== null,
    identifiesCommand,
    installationChannels: MANIFEST.installationChannels,
    hookProxyAvailable,
  });
}

export const rtkAdapter: ProviderAdapter = {
  manifest: MANIFEST,
  detect,
  verify,
  collectMetrics,
  identifiesCommand,
  plan,
};

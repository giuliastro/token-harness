/**
 * RTK — PLAN §10, written against RFC 0007.
 *
 * This is the adapter that closes the verification loop. The Phase 2.5 spike proved tier
 * 3 on Claude Code by hand: it ran one command through the Bash tool and watched RTK's
 * recorded command count move by exactly one. Everything since has been able to *declare*
 * that tier without demonstrating it, and the Claude adapter reports the canary check as
 * `not-exercised` for exactly that reason. This is what makes it a `pass`.
 *
 * ## The receipt
 *
 * `rtk gain --all --format json` returns machine-readable analytics:
 *
 * ```json
 * { "summary": { "total_commands": 2815, "total_saved": 91426, … },
 *   "daily": [ { "date": "2026-07-30", "commands": 500, "saved_tokens": 20130, … } ] }
 * ```
 *
 * PLAN §10 forbids parsing human `rtk gain` output "when JSON is available". It is
 * available, and the `--format json` flag is what this adapter uses.
 *
 * The `daily` array is what makes the receipt *dated*. A cumulative counter proves
 * interception happened at some point in the tool's history; a dated entry proves it
 * happened on a day, which is the claim RFC 0007 requires a passive receipt to be able to
 * make.
 *
 * ## What this adapter does not do
 *
 * It does not duplicate RTK's rewrite registry — PLAN §10's first constraint. It knows
 * which commands RTK intercepts only in the sense that RTK told it how many, and it never
 * decides what should have been rewritten. There is no installation plan here either:
 * that is a separate lifecycle stage, and PLAN §15 asks for one per PR when large.
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
  type JsonValue,
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
const OPENCODE = harnessId('opencode');

/**
 * The tested range is what has been observed, not what has been proven by a suite. `0.42.0`
 * is the version whose `--format json` output this adapter parses and whose interception
 * the Phase 2.5 spike watched; `0.44.0` is the version spike 9.1 watched intercept OpenCode.
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
      // The surface the Phase 2.5 spike actually watched: a `PreToolUse` hook matching
      // `Bash`. `PowerShell` is deliberately absent — the spike ran the identical command
      // through it and RTK's counter did not move, which is the coverage gap `doctor`
      // reports as `tool-family-not-covered`. Claiming it here would make the resolver
      // hand RTK a scope it demonstrably does not serve.
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'pre-tool-use' }],
      // RFC 0003 §Rule wants the evidence recorded at a version. The reference is the
      // hook the Phase 2.5 spike read, not a line of RTK's source: what was demonstrated
      // is that the harness routes commands through it, which is the claim being made.
      evidence: {
        sourceReference: 'docs/spikes/2.5-live-verification-log.md',
        upstreamVersion: '0.42.0',
      },
    },
    {
      capability: 'shell.output.reduce',
      mode: 'exclusive',
      harnesses: [CLAUDE],
      // Same surface: RTK rewrites the command at `PreToolUse` and the rewritten command is
      // what filters the output, so both capabilities are served from one interception point.
      surfaces: [{ toolFamily: 'Bash', interceptionPoint: 'pre-tool-use' }],
      evidence: {
        sourceReference: 'docs/spikes/2.5-live-verification-log.md',
        upstreamVersion: '0.42.0',
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
      testedVersions: { minimum: '2.0.0', maximum: '2.1.212' },
      verificationTier: 'canary',
    },
    {
      harness: OPENCODE,
      // Spike 9.1 watched interception on the CLI at `1.18.11` and watched it fail on Desktop at
      // `1.18.14`. The range covers both because both were observed; the failure is a declared
      // platform limitation below rather than a narrower range, because it is a property of the
      // host application and not of the OpenCode version — the same 1.18.x plugin loads in both.
      testedVersions: { minimum: '1.18.11', maximum: '1.18.14' },
      /**
       * `config-only`, even though spike 9.1 watched a canary-grade interception here — the counter
       * moved by exactly the number of shell calls the OpenCode session made.
       *
       * A tier is what `verify` can prove on the user's machine, not what a spike proved once on a
       * clean one. RTK's receipt is its history database, and the `commands` table carries
       * `timestamp`, token counts, `exec_time_ms`, and `project_path` — no harness column, and no
       * column standing in for one. The spike could attribute those rows because it ran OpenCode
       * alone in a scratch directory and read the counter either side; `verify` runs where both
       * harnesses are wired to the same binary and writing into the same table, and cannot say
       * which of them a row came from.
       *
       * Declaring `canary` here would credit RTK's whole command history to whichever harness the
       * reader happened to be looking at. Claude Code keeps `canary` because its own hook receipt
       * is per-harness; this one is provider-wide, and RFC 0007 asks the question per harness.
       */
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
    locations: ['<user data directory>/rtk/history.db'],
  },
  delegatedInstallReviews: null,
};

const TESTED_VERSIONS = { minimum: '0.40.0', maximum: '0.44.0' };
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

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Analytics {
  totalCommands: number;
  totalSaved: number;
  /** Most recent day carrying at least one command, or null when there is none. */
  latestDay: { date: string; commands: number } | null;
}

/**
 * Reads `rtk gain --all --format json`.
 *
 * Returns null when the document is not the shape this build understands, rather than
 * guessing at a partial read: an analytics document from a future RTK could carry the same
 * keys with different meanings, and a savings figure derived from a guess is exactly what
 * RFC 0005 exists to prevent.
 */
export function parseRtkAnalytics(text: string): Analytics | null {
  let document: JsonValue;
  try {
    document = JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
  if (!isRecord(document)) return null;

  const summary = document['summary'];
  if (!isRecord(summary)) return null;
  const totalCommands = summary['total_commands'];
  const totalSaved = summary['total_saved'];
  if (typeof totalCommands !== 'number') return null;

  const daily = document['daily'];
  let latestDay: Analytics['latestDay'] = null;
  if (Array.isArray(daily)) {
    for (const entry of daily) {
      if (!isRecord(entry)) continue;
      const date = entry['date'];
      const commands = entry['commands'];
      if (typeof date !== 'string' || typeof commands !== 'number' || commands <= 0) continue;
      if (latestDay === null || date > latestDay.date) latestDay = { date, commands };
    }
  }

  return {
    totalCommands,
    totalSaved: typeof totalSaved === 'number' ? totalSaved : 0,
    latestDay,
  };
}

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

async function readAnalytics(
  context: ProviderContext,
): Promise<{ analytics: Analytics | null; evidence: Evidence[] }> {
  const outcome = await context.runner.run({
    executable: 'rtk',
    args: ['gain', '--all', '--format', 'json'],
    cwd: context.projectRoot,
    timeoutMs: 30_000,
  });
  if (outcome.failure !== null || outcome.exitCode !== 0) {
    return {
      analytics: null,
      evidence: [
        evidence({
          kind: 'absence',
          source: 'rtk gain --all --format json',
          detail: 'analytics could not be read',
        }),
      ],
    };
  }
  const analytics = parseRtkAnalytics(outcome.stdout);
  return {
    analytics,
    evidence: [
      evidence({
        kind: 'provider-doctor',
        source: 'rtk gain --all --format json',
        detail:
          analytics === null
            ? 'analytics document was not in a shape this build understands'
            : `${String(analytics.totalCommands)} operations recorded`,
      }),
    ],
  };
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

  // RFC 0002 §Detection: never infer from a configuration string alone. A harness wired to
  // rtk with no runnable rtk is `broken` — the integration is present and cannot work.
  const state: ProviderState =
    version.version === null
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
     * The field asks whether this manifest names a harness with no adapter behind it. It names two,
     * Claude Code and OpenCode, and both are managed — so the qualifier RFC 0006's doctor transcript
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
     * Always, and independent of the observed version.
     *
     * RTK's assignment is produced by this build writing the hook itself — `rtk-plan.ts` appends
     * the entry — so nothing about the installed `rtk` decides whether the state is reachable.
     * That is the difference from HarnessTrim, whose assignment is produced by *its* installer and
     * therefore depends on which flags that installer has.
     */
    assignable: true,
    evidence: evidenceItems,
    warnings,
  };
}

/**
 * Verification, passive.
 *
 * The canary check is the point of this adapter. RTK records each intercepted command in
 * its own analytics, dated by day, so an operation the harness performed anyway leaves a
 * receipt — and reading it costs nothing. RFC 0007 §Active and passive canaries makes that
 * the default for a routine `verify`; the active form costs a model call and is never run
 * by a read-only command.
 */
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
  checks.push({
    id: 'hook-registered',
    status: configured.length > 0 ? 'pass' : 'not-exercised',
    summary:
      configured.length > 0
        ? `wired to ${configured.join(', ')}`
        : 'no harness configuration names rtk',
    achievedTier: configured.length > 0 ? 'config-only' : null,
    evidence: [],
    remediation: null,
  });

  const { analytics, evidence: analyticsEvidence } = await readAnalytics(context);
  let receipt: PassiveReceipt | null = null;

  if (analytics === null) {
    checks.push({
      id: 'analytics-readable',
      status: 'fail',
      summary: 'rtk analytics could not be read as JSON',
      achievedTier: null,
      evidence: analyticsEvidence,
      remediation: 'Check that `rtk gain --all --format json` succeeds',
    });
  } else if (analytics.latestDay === null) {
    // RFC 0007: a passive canary with no observed operation is not a pass. Nothing is
    // wrong; nothing has happened yet.
    checks.push({
      id: 'canary-intercepted',
      status: 'not-exercised',
      summary: 'rtk has recorded no intercepted command yet',
      achievedTier: null,
      evidence: analyticsEvidence,
      remediation: 'Run a command through the harness, then verify again',
    });
  } else {
    receipt = {
      observedAt: analytics.latestDay.date,
      operations: analytics.latestDay.commands,
      source: 'rtk gain --all --format json',
    };
    checks.push({
      id: 'canary-intercepted',
      status: 'pass',
      summary: `${String(analytics.latestDay.commands)} commands intercepted on ${analytics.latestDay.date}`,
      // The tier the spike demonstrated by hand, now read from the provider's own record.
      achievedTier: 'canary',
      evidence: analyticsEvidence,
      remediation: null,
    });

    // RFC 0007: the receipt states *when*. A stale one is not a failure, and saying so
    // out loud is the difference between "working" and "worked at some point".
    const ageDays = receiptAgeInDays(analytics.latestDay.date, context);
    if (ageDays !== null && ageDays > STALE_RECEIPT_DAYS) {
      checks.push({
        id: 'receipt-freshness',
        status: 'info',
        summary: `the most recent intercepted command was ${String(ageDays)} days ago`,
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
 * The CLI analytics keep the job they already had: the passive verification receipt above.
 * They are not turned into events.
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
function toEvent(row: LocalDatabaseRow, context: ProviderContext): OptimizationEvent | null {
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
    eventId: `rtk-history-${String(id)}`,
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
      harnessId: 'unknown',
      sessionId: null,
      operationId: `rtk-history-${String(id)}`,
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
  const diagnostics: Diagnostic[] = [];
  const path = rtkDatabasePath(context);

  const unavailable = (detail: string, remediation: string | null): MetricsImport => {
    diagnostics.push(
      diagnostic({
        // Not a warning. RFC 0005: running in a degraded mode "is a supported steady state,
        // not a warning". What would be a defect is presenting a degraded figure as exact.
        severity: 'info',
        code: 'provider-metrics-unavailable',
        message: detail,
        path,
        remediation,
      }),
    );
    return {
      providerId: RTK,
      mode: 'unavailable',
      source: null,
      imported: 0,
      skipped: 0,
      cursor: null,
      diagnostics,
    };
  };

  if (context.localDatabase === null) {
    return unavailable(
      'this host supplied no local-database reader, so RTK metrics were not imported',
      null,
    );
  }

  const generation = await context.localDatabase.query({
    path,
    sql: GENERATION_QUERY,
    parameters: [],
  });
  if (generation.failure !== null) {
    const message =
      generation.failure === 'not-found'
        ? 'RTK has recorded no command history on this machine yet'
        : `RTK's command history could not be read (${generation.failure})`;
    return unavailable(
      message,
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
  if (stored !== null && stored.highWaterMark !== null) {
    const previous = Number(stored.highWaterMark);
    // A generation change means the table was reset, so the stored mark refers to rows that
    // no longer exist. Restarting from zero is correct and safe: the event identity is the
    // native row id, so anything already stored keeps its identity.
    // `high < previous` catches a reset that happened to reproduce the same `MIN(id)`: rows
    // this cursor claims are gone, so the mark refers to nothing.
    const sameGeneration = stored.fileIdentity === identity && (high === null || high >= previous);
    if (sameGeneration && Number.isFinite(previous)) {
      from = previous;
    } else if (!sameGeneration) {
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'provider-metrics-source-reset',
          message:
            "RTK's command history was reset since the last import, so it is being read from the start",
          path,
          remediation: null,
        }),
      );
    }
  }

  // Nothing new. Reported as a successful native import of zero rather than as an absence:
  // the source is there and readable, and `status` should not show it as unavailable.
  if (high !== null && from >= high) {
    return {
      providerId: RTK,
      mode: 'native',
      source: SOURCE_LABEL,
      imported: 0,
      skipped: 0,
      cursor: stored,
      diagnostics,
    };
  }

  const batch = await context.localDatabase.query({
    path,
    sql: HISTORY_QUERY,
    parameters: [from, IMPORT_BATCH_SIZE],
  });
  if (batch.failure !== null) {
    return unavailable(`RTK's command history could not be read (${batch.failure})`, null);
  }

  const events: OptimizationEvent[] = [];
  let skipped = 0;
  let highest = from;
  for (const row of batch.rows) {
    const id = numberAt(row, 'id');
    if (id !== null && id > highest) highest = id;
    const event = toEvent(row, context);
    if (event === null) {
      skipped += 1;
      continue;
    }
    events.push(event);
  }

  if (skipped > 0) {
    diagnostics.push(
      diagnostic({
        // A warning, unlike the degraded mode above: a row this build cannot read means the
        // upstream schema moved, and a savings total quietly missing rows is the failure
        // RFC 0005 exists to prevent.
        severity: 'warning',
        code: 'provider-metrics-rows-skipped',
        message: `${String(skipped)} of ${String(batch.rows.length)} RTK history rows were not in a shape this build understands`,
        path,
        remediation: 'Check whether RTK changed its history schema',
      }),
    );
  }

  // The append happens before the cursor moves. The other order would advance past records
  // that were never stored if the write failed, and nothing afterwards could tell.
  await store.appendEvents(events);

  const cursor: ImportCursor = {
    providerId: RTK,
    sourceId: path,
    absolutePath: path,
    fileIdentity: identity,
    // Meaningless for this source; the RFC 0005 amendment says which member is authoritative.
    byteOffset: 0,
    lastLineDigest: null,
    highWaterMark: String(highest),
    updatedAt: context.now(),
  };
  await store.writeCursor(cursor);

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
    providerId: RTK,
    mode: 'native',
    source: SOURCE_LABEL,
    imported: events.length,
    skipped,
    cursor,
    diagnostics,
  };
}

const SOURCE_LABEL = 'rtk history.db (commands)';

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
  return HOOK_COMMAND_PATTERN.test(command) || PLUGIN_MODULE_PATTERN.test(command);
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
  return buildRtkPlan({
    context,
    request,
    installed: version.version !== null,
    identifiesCommand,
    installationChannels: MANIFEST.installationChannels,
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

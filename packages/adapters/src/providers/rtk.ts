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
  providerId,
  type Diagnostic,
  type Evidence,
  type HarnessId,
  type JsonValue,
  type ProviderDetection,
  type ProviderManifest,
  type ProviderState,
  type VerificationCheck,
  type VersionVerdict,
} from '@token-harness/core';

import type {
  PassiveReceipt,
  ProviderAdapter,
  ProviderContext,
  ProviderVerification,
} from './contract.js';

const RTK = providerId('rtk');
const CLAUDE = harnessId('claude');

/**
 * The tested range is what has been observed, not what has been proven by a suite. `0.42.0`
 * is the version whose `--format json` output this adapter parses and whose interception
 * the spike watched.
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
      evidence: {
        sourceReference: 'docs/spikes/2.5-live-verification-log.md',
        upstreamVersion: '0.42.0',
      },
    },
  ],
  platforms: [
    { os: 'windows', wsl: false, supported: true, limitation: null },
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
  ],
  installationChannels: [
    {
      id: 'winget',
      kind: 'github-release',
      priority: 0,
      platforms: ['windows'],
      requiresNetwork: true,
      requiresElevation: false,
      digestAvailable: true,
    },
    {
      id: 'cargo',
      kind: 'cargo',
      priority: 1,
      platforms: ['windows', 'macos', 'linux'],
      requiresNetwork: true,
      requiresElevation: false,
      digestAvailable: false,
    },
  ],
  metrics: {
    // PLAN §10: "do not parse human `rtk gain` output when JSON is available." It is.
    source: 'cli-json',
    mode: 'native',
    locations: [],
  },
  delegatedInstallReview: null,
};

const TESTED_VERSIONS = { minimum: '0.40.0', maximum: '0.42.0' };
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

/** The token that identifies an RTK hook command, per the shape the spike observed. */
const HOOK_COMMAND_PATTERN = /(^|[\\/\s"'])rtk(\.exe)?([\s"']|$)/i;

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

/** Harnesses whose configuration names RTK in a hook command. */
export function harnessesWiredToRtk(
  configs: readonly ProviderContext['harnessConfigs'][number][],
): HarnessId[] {
  const wired = new Set<HarnessId>();
  for (const config of configs) {
    if (config.commands.some((command) => HOOK_COMMAND_PATTERN.test(command))) {
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
    // RFC 0002 §Providers may exceed the managed surface. RTK's manifest covers Claude
    // Code only, so the qualifier RFC 0006's doctor transcript uses for HarnessTrim does
    // not apply here.
    supportsUnmanagedHarnesses: false,
    // RFC 0004 §Brownfield adoption: nothing has been applied by Token Harness yet, so
    // every installation it finds is the user's.
    managedByTokenHarness: false,
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

export const rtkAdapter: ProviderAdapter = { manifest: MANIFEST, detect, verify };

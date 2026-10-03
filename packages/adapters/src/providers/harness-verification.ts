import {
  providerId,
  type HarnessId,
  type VerificationCheck,
  type VerificationTier,
} from '@token-harness/core';

import type { PassiveReceipt, ProviderContext, ProviderVerification } from './contract.js';
import { harnessesWiredToHarnessTrim, metricsLocations } from './harnesstrim.js';

const HARNESSTRIM = providerId('harnesstrim');
const RTK = providerId('rtk');

interface HarnessTrimReceiptEnvelope {
  ts: string;
  harness: string;
  beforeChars: number;
  afterChars: number;
  changed: boolean | null;
  reductionFailed: boolean;
}

/**
 * Parse only the stable attribution envelope HarnessTrim puts on a metrics event.
 *
 * This deliberately mirrors the validity boundary used by the full HarnessTrim importer without
 * reimplementing its reduction semantics: attribution needs only the native harness identity and
 * timestamp, but a malformed/future event must not become stronger verification evidence than it
 * would become metrics evidence.
 */
function parseHarnessTrimReceiptEnvelope(line: string): HarnessTrimReceiptEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (
    typeof record['ts'] !== 'string' ||
    typeof record['harness'] !== 'string' ||
    typeof record['beforeChars'] !== 'number' ||
    typeof record['afterChars'] !== 'number'
  ) {
    return null;
  }

  const schemaVersion = typeof record['schemaVersion'] === 'number' ? record['schemaVersion'] : 0;
  if (schemaVersion > 1) return null;
  if (
    schemaVersion === 1 &&
    (typeof record['eventId'] !== 'string' || record['eventId'].length === 0)
  ) {
    return null;
  }

  return {
    ts: record['ts'],
    harness: record['harness'],
    beforeChars: record['beforeChars'],
    afterChars: record['afterChars'],
    changed: typeof record['changed'] === 'boolean' ? record['changed'] : null,
    reductionFailed: record['reductionFailed'] === true,
  };
}

function provesHarnessTrimReduction(event: HarnessTrimReceiptEnvelope): boolean {
  return (
    !event.reductionFailed &&
    event.afterChars < event.beforeChars &&
    // Native receipts explicitly mark pass-throughs. Legacy receipts predate this bit, so a
    // strictly smaller after-size remains the only available evidence that the hook reduced it.
    event.changed !== false
  );
}

async function harnessTrimReceiptFor(
  context: ProviderContext,
  harnessId: HarnessId,
): Promise<PassiveReceipt | null> {
  for (const path of metricsLocations(context)) {
    const stat = await context.fs.stat(path);
    if (stat === null || stat.byteLength === 0) continue;

    const text = new TextDecoder().decode(await context.fs.readFile(path));
    const matches = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map(parseHarnessTrimReceiptEnvelope)
      .filter(
        (event): event is HarnessTrimReceiptEnvelope =>
          event !== null && event.harness === harnessId,
      );
    const latestAttempt = matches.at(-1);
    if (latestAttempt !== undefined) {
      const reductions = matches.filter(provesHarnessTrimReduction);
      return {
        observedAt: latestAttempt.ts,
        operations: reductions.length,
        attempts: matches.length,
        source: path,
      };
    }
  }
  return null;
}

function strongestTier(checks: readonly VerificationCheck[]): VerificationTier | null {
  const order: readonly VerificationTier[] = ['canary', 'config-only', 'presence'];
  return order.find((tier) => checks.some((check) => check.achievedTier === tier)) ?? null;
}

function scopeHookCheck(
  check: VerificationCheck,
  harnessId: HarnessId,
  configured: boolean,
): VerificationCheck {
  if (check.id !== 'hook-registered' || check.status === 'fail') return check;
  return configured
    ? {
        ...check,
        status: 'pass',
        summary: `wired to ${harnessId}`,
        achievedTier: 'config-only',
      }
    : {
        ...check,
        status: 'not-exercised',
        summary: `not wired to ${harnessId}`,
        achievedTier: null,
      };
}

function scopeCanaryCheck(
  check: VerificationCheck,
  input: {
    harnessId: HarnessId;
    configured: boolean;
    runtimeConfigured: boolean;
    configuredHarnesses: readonly HarnessId[];
    receipt: PassiveReceipt | null;
    providerHasAttributableReceipt: boolean;
  },
): VerificationCheck {
  if (check.id !== 'canary-intercepted' || check.status === 'fail') return check;

  if (!input.configured) {
    return {
      ...check,
      status: 'not-exercised',
      summary: `no current integration is wired to ${input.harnessId}`,
      achievedTier: null,
    };
  }

  if (input.providerHasAttributableReceipt) {
    if (input.receipt === null) {
      return {
        ...check,
        status: 'not-exercised',
        summary: `no telemetry receipt attributed to ${input.harnessId} yet`,
        achievedTier: null,
        remediation: input.runtimeConfigured
          ? 'Enable telemetry on this runtime integration and use it on an output it can reduce.'
          : 'Skills or instructions alone do not write reduction telemetry; a compatible measurement path is required.',
      };
    }
    if (input.receipt.operations === 0) {
      return {
        ...check,
        status: 'info',
        summary: `HarnessTrim observed ${String(input.receipt.attempts ?? 0)} ${input.harnessId} outputs, but none was reduced; latest attempt ${input.receipt.observedAt}`,
        achievedTier: null,
        remediation:
          'Run a canary that produces output the installed HarnessTrim reducer can shorten, then verify again.',
      };
    }
    return {
      ...check,
      status: 'pass',
      summary: `${String(input.receipt.operations)} reductions recorded for ${input.harnessId} from ${String(input.receipt.attempts ?? input.receipt.operations)} observed outputs, most recently ${input.receipt.observedAt}`,
      achievedTier: 'canary',
    };
  }

  if (check.status === 'pass' && check.achievedTier === 'canary') {
    return {
      ...check,
      status: 'info',
      summary:
        `provider telemetry shows runtime activity, but it cannot attribute that receipt to ${input.harnessId}` +
        ` while ${String(input.configuredHarnesses.length)} harnesses are wired`,
      achievedTier: null,
      remediation: null,
    };
  }

  return check;
}

function scopeIntegrationCheck(
  check: VerificationCheck,
  input: { harnessId: HarnessId; configured: boolean; runtimeConfigured: boolean },
): VerificationCheck {
  if (check.id !== 'integration-configured') return check;
  if (!input.configured) {
    return {
      ...check,
      status: 'not-exercised',
      summary: `no HarnessTrim integration is configured for ${input.harnessId}`,
      achievedTier: null,
      remediation: 'Set up a compatible HarnessTrim measurement path for this coding agent.',
    };
  }
  if (!input.runtimeConfigured) {
    return {
      ...check,
      status: 'info',
      summary: `HarnessTrim skills or instructions were found for ${input.harnessId}, but no runtime reduction hook or plugin is configured`,
      achievedTier: null,
      remediation: 'Skills provide guidance; they do not prove an output reduction was recorded.',
    };
  }
  return {
    ...check,
    status: 'pass',
    summary: `runtime HarnessTrim integration configured for ${input.harnessId}`,
    achievedTier: 'config-only',
    remediation: null,
  };
}

/**
 * Project one provider-wide verification onto one exact provider × harness integration.
 *
 * Provider adapters historically verify once and `verify` renders one row per configured harness.
 * Reusing the same passive receipt on every row overclaims evidence whenever a provider serves more
 * than one harness. This function is the conservative attribution boundary:
 *
 * - HarnessTrim can attribute receipts exactly when a TrimEvent names the requested harness;
 * - a provider-wide receipt can be attributed by exclusion only when exactly one harness is wired;
 * - a skills-only setup is not a runtime hook and cannot raise verification above provider presence;
 * - otherwise the provider may still be healthy/configured, but its runtime receipt is unavailable
 *   as evidence for any exact harness row.
 *
 * No active canary is run and no configuration is changed.
 */
export async function scopeProviderVerificationToHarness(
  context: ProviderContext,
  verification: ProviderVerification,
  harnessId: HarnessId,
  configuredHarnesses: readonly HarnessId[],
): Promise<ProviderVerification> {
  const configured = configuredHarnesses.includes(harnessId);
  const harnessTrim = verification.providerId === HARNESSTRIM;
  const runtimeConfigured = harnessTrim
    ? harnessesWiredToHarnessTrim(context.harnessConfigs).includes(harnessId)
    : configured;
  const attributableByExclusion =
    configured && configuredHarnesses.length === 1 && configuredHarnesses[0] === harnessId;

  const receipt = !configured
    ? null
    : harnessTrim
      ? await harnessTrimReceiptFor(context, harnessId)
      : verification.receipt?.harnessId !== undefined
        ? verification.receipt.harnessId === harnessId
          ? verification.receipt
          : null
        : attributableByExclusion
          ? verification.receipt
          : null;
  const providerHasAttributableReceipt = harnessTrim || attributableByExclusion;

  // RTK emits one attribution/freshness check per harness. Keep only the requested row's
  // checks; otherwise Codex's activity can make Claude appear exercised (or vice versa).
  const scopedSourceChecks =
    verification.providerId === RTK
      ? verification.checks.filter((check) => {
          const match = /^(?:rtk-attribution|receipt-freshness)-(claude|codex)$/.exec(check.id);
          return match === null || match[1] === harnessId;
        })
      : verification.checks;

  const checks = scopedSourceChecks.map((check) =>
    scopeCanaryCheck(
      scopeIntegrationCheck(
        scopeHookCheck(check, harnessId, harnessTrim ? runtimeConfigured : configured),
        { harnessId, configured, runtimeConfigured },
      ),
      {
        harnessId,
        configured,
        runtimeConfigured,
        configuredHarnesses,
        receipt,
        providerHasAttributableReceipt,
      },
    ),
  );

  return {
    ...verification,
    achievedTier: strongestTier(checks),
    receipt,
    checks,
  };
}

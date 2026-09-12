import {
  providerId,
  type HarnessId,
  type VerificationCheck,
  type VerificationTier,
} from '@token-harness/core';

import type { PassiveReceipt, ProviderContext, ProviderVerification } from './contract.js';
import { metricsLocations } from './harnesstrim.js';

const HARNESSTRIM = providerId('harnesstrim');

interface HarnessTrimReceiptEnvelope {
  ts: string;
  harness: string;
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

  return { ts: record['ts'], harness: record['harness'] };
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
    const latest = matches.at(-1);
    if (latest !== undefined) {
      return { observedAt: latest.ts, operations: matches.length, source: path };
    }
  }
  return null;
}

function strongestTier(checks: readonly VerificationCheck[]): VerificationTier | null {
  const order: readonly VerificationTier[] = ['live-receipt', 'canary', 'config-only', 'presence'];
  return order.find((tier) => checks.some((check) => check.achievedTier === tier)) ?? null;
}

function scopeHookCheck(
  check: VerificationCheck,
  harnessId: HarnessId,
  configured: boolean,
): VerificationCheck {
  if (check.id !== 'hook-registered') return check;
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
    configuredHarnesses: readonly HarnessId[];
    receipt: PassiveReceipt | null;
    providerHasAttributableReceipt: boolean;
  },
): VerificationCheck {
  if (check.id !== 'canary-intercepted') return check;

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
      };
    }
    return {
      ...check,
      status: 'pass',
      summary: `${String(input.receipt.operations)} reductions recorded for ${input.harnessId}, most recently ${input.receipt.observedAt}`,
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

/**
 * Project one provider-wide verification onto one exact provider × harness integration.
 *
 * Provider adapters historically verify once and `verify` renders one row per configured harness.
 * Reusing the same passive receipt on every row overclaims evidence whenever a provider serves more
 * than one harness. This function is the conservative attribution boundary:
 *
 * - HarnessTrim can attribute receipts exactly because every TrimEvent carries `harness`;
 * - a provider-wide receipt can be attributed by exclusion only when exactly one harness is wired;
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
  const attributableByExclusion =
    configured && configuredHarnesses.length === 1 && configuredHarnesses[0] === harnessId;

  const receipt = !configured
    ? null
    : harnessTrim
      ? await harnessTrimReceiptFor(context, harnessId)
      : attributableByExclusion
        ? verification.receipt
        : null;
  const providerHasAttributableReceipt = harnessTrim || attributableByExclusion;

  const checks = verification.checks.map((check) =>
    scopeCanaryCheck(scopeHookCheck(check, harnessId, configured), {
      harnessId,
      configured,
      configuredHarnesses,
      receipt,
      providerHasAttributableReceipt,
    }),
  );

  return {
    ...verification,
    achievedTier: strongestTier(checks),
    receipt,
    checks,
  };
}

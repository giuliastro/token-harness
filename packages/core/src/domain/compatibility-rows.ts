/**
 * RFC 0009 §Compatibility matrix — the row that admits managed mutation.
 *
 * ## A row is evidence, not a semver guess
 *
 * RFC 0009: "Token Harness manages only a harness/provider/version combination represented by a
 * reviewed compatibility fixture. Detection is broad; mutation is intentionally narrower." A row
 * records one provider × harness × harness-version-range × provider-version × platform
 * combination that a fixture has actually been reviewed against, and nothing else may admit a
 * managed mutation: neither a lockfile, nor a successful executable probe, nor a version that
 * merely shares a major.
 *
 * ## This is not RFC 0003's compatibility rule
 *
 * `CompatibilityRule` (domain/compatibility.ts) answers "which of two contesting providers owns
 * this interception point, and in what order" — it arbitrates, and the resolver consults it. A
 * row answers "may Token Harness mutate this one integration at these versions on this platform".
 * The two share only a name and a fixture reference, deliberately. Nothing in `planner/` may
 * import this module: the arbitration path must not be able to reach a row, and the resolver's
 * output is tested to be independent of the row table.
 *
 * ## Classification of a version outside every row
 *
 * RFC 0009: "A version outside every row is still reported by `doctor`. It is classified as
 * `unknown-newer`, `unknown-older`, or `below-range` and prevents a managed apply."
 *
 * The three classes are positions relative to the row set for one provider × harness × platform
 * key, sorted by harness version range:
 *
 * - `unknown-newer` — newer than every row's maximum. No schema for anything this new has been
 *   observed.
 * - `unknown-older` — older than every row's minimum. The row that exists was observed at a
 *   version this old one has not reached.
 * - `below-range` — inside the span between the lowest minimum and the highest maximum but
 *   covered by no single row: a gap between rows. The version is below the range of the next
 *   row above it.
 *
 * All three refuse a managed mutation; the refusal names the missing harness schema (for the
 * range verdicts) or the missing provider fixture (when the provider version matches no row).
 */

import type { VerificationTier } from './detection.js';
import type { HarnessId, ProviderId } from './ids.js';
import type { PlatformSupport } from './manifest.js';
import type { OperatingSystem } from './platform.js';
import { compareVersions, parseSemanticVersion, type SemanticVersion } from './version.js';

/** RFC 0009 §Compatibility matrix — one reviewed, immutable row. */
export interface CompatibilityRow {
  harness: HarnessId;
  harnessVersion: { minimum: string; maximum: string };
  provider: ProviderId;
  providerVersion: string;
  platform: PlatformSupport;
  configSchema: string;
  fixture: string;
  verificationTier: VerificationTier;
}

/**
 * The rows shipped in this build.
 *
 * RFC 0009 §Initial delivery order item 5: "Add matrix rows only after the relevant
 * cross-platform fixtures and verification evidence pass." Every row below names the recording that
 * admits it. Every other combination stays refused with the missing schema or fixture named — the
 * table is an admission set, not a list of things that probably work.
 *
 * Windows supplied the first reviewed rows. Linux now has one exact HarnessTrim × Codex row recorded
 * on a real Zorin machine at Codex 0.152.1 / HarnessTrim 0.2.1. That does not widen any Windows row
 * and does not imply nearby Linux versions are compatible: the harness range remains a point and the
 * provider version remains exact. macOS still has no reviewed mutation row.
 *
 * ## What each row is standing on
 *
 * The harness range is a point, not a span: one Claude Code version was observed, so one is claimed.
 * A newer one reads `unknown-newer` and refuses, which is a true statement rather than a guess that
 * `2.1.221` behaves like `2.1.220`.
 *
 * The tiers differ because the evidence does. RTK's row claims `canary`: its history database is a
 * per-harness receipt `verify` can read on the user's machine. HarnessTrim's claims `config-only`:
 * the skills-only install deliberately writes no hook, so nothing outside the configuration can
 * witness it. A row must not promise a tier `verify` cannot reach.
 */
export const COMPATIBILITY_ROWS: readonly CompatibilityRow[] = [
  {
    harness: 'claude' as HarnessId,
    harnessVersion: { minimum: '2.1.220', maximum: '2.1.220' },
    provider: 'rtk' as ProviderId,
    providerVersion: '0.44.0',
    platform: { os: 'windows', wsl: false, supported: true, limitation: null },
    configSchema: 'claude-settings-json-hooks',
    fixture: 'tests/fixtures/rows/rtk-claude-windows',
    verificationTier: 'canary',
  },
  {
    harness: 'claude' as HarnessId,
    harnessVersion: { minimum: '2.1.220', maximum: '2.1.220' },
    provider: 'harnesstrim' as ProviderId,
    providerVersion: '0.1.0',
    platform: { os: 'windows', wsl: false, supported: true, limitation: null },
    // The install writes skill files, not a document this build parses, so the schema it depends on
    // is the skills directory layout rather than `settings.json`.
    configSchema: 'claude-skills-directory',
    fixture: 'tests/fixtures/rows/harnesstrim-claude-windows',
    verificationTier: 'config-only',
  },
  {
    harness: 'codex' as HarnessId,
    harnessVersion: { minimum: '0.146.0', maximum: '0.146.0' },
    provider: 'harnesstrim' as ProviderId,
    providerVersion: '0.1.0',
    platform: { os: 'windows', wsl: false, supported: true, limitation: null },
    // The same shape as the Claude skills row, and for the same reason: the install writes skill
    // files rather than a document this build parses, so the schema it depends on is the directory
    // layout. A separate id because the directory is `.codex/skills` and the protected paths differ.
    configSchema: 'codex-skills-directory',
    fixture: 'tests/fixtures/rows/harnesstrim-codex-windows',
    verificationTier: 'config-only',
  },
  {
    harness: 'codex' as HarnessId,
    harnessVersion: { minimum: '0.152.1', maximum: '0.152.1' },
    provider: 'harnesstrim' as ProviderId,
    providerVersion: '0.2.1',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Real Zorin/Linux recording: skills-only apply, drift + verified rollback, and surgical
    // uninstall all preserved the user's own skill and AGENTS.md.
    configSchema: 'codex-skills-directory',
    fixture: 'tests/fixtures/rows/harnesstrim-codex-linux-0.152.1-0.2.1',
    verificationTier: 'config-only',
  },
];

export type RowHarnessVerdict = 'in-row' | 'unknown-newer' | 'unknown-older' | 'below-range';

/**
 * Classifies an observed harness version against the rows for its provider × harness × platform
 * key. An empty row set has no position at all; `null` expresses that.
 */
export function classifyRowHarnessVersion(
  rows: readonly CompatibilityRow[],
  observed: string,
): RowHarnessVerdict | null {
  if (rows.length === 0) return null;
  const parsed = parseSemanticVersion(observed);
  if (parsed === null) return null;

  let lowestMinimum: SemanticVersion | null = null;
  let highestMaximum: SemanticVersion | null = null;
  for (const row of rows) {
    const minimum = parseSemanticVersion(row.harnessVersion.minimum);
    const maximum = parseSemanticVersion(row.harnessVersion.maximum);
    if (minimum === null || maximum === null) continue;
    if (compareVersions(parsed, minimum) >= 0 && compareVersions(parsed, maximum) <= 0)
      return 'in-row';
    if (lowestMinimum === null || compareVersions(minimum, lowestMinimum) < 0)
      lowestMinimum = minimum;
    if (highestMaximum === null || compareVersions(maximum, highestMaximum) > 0)
      highestMaximum = maximum;
  }
  if (lowestMinimum === null || highestMaximum === null) return null;
  if (compareVersions(parsed, lowestMinimum) < 0) return 'unknown-older';
  if (compareVersions(parsed, highestMaximum) > 0) return 'unknown-newer';
  return 'below-range';
}

/** The provider × harness × version × platform combination a managed mutation would run under. */
export interface ManagedCombination {
  provider: ProviderId;
  /** The installed provider version, or null when it could not be established. */
  providerVersion: string | null;
  harness: HarnessId;
  /** The installed harness version, or null when it could not be established. */
  harnessVersion: string | null;
  os: OperatingSystem;
  wsl: boolean;
}

export type AdmissionOutcome =
  | { readonly state: 'admitted'; readonly row: CompatibilityRow }
  | {
      readonly state: 'refused';
      readonly verdict: 'no-row' | 'unknown-newer' | 'unknown-older' | 'below-range';
      /** What a row would have to name: the missing harness schema or provider fixture. */
      readonly missing: string;
    };

/** The rows for one provider × harness × platform key. */
function rowsFor(
  rows: readonly CompatibilityRow[],
  combination: ManagedCombination,
): CompatibilityRow[] {
  return rows.filter(
    (row) =>
      row.provider === combination.provider &&
      row.harness === combination.harness &&
      row.platform.os === combination.os &&
      row.platform.wsl === combination.wsl &&
      row.platform.supported,
  );
}

/**
 * The managed-mutation gate — RFC 0009 §Compatibility matrix.
 *
 * The only inputs are the row table and the observed combination. There is no input for a
 * lockfile, a probe, or a major version, and that is the point: RFC 0009 forbids treating any of
 * them as proof that a row applies, and a gate that accepted them would be the semver guess the
 * matrix exists to reject. When the gate refuses, the refusal names what a row would have to
 * carry — the missing config schema or provider fixture.
 */
export function admitManagedMutation(
  rows: readonly CompatibilityRow[],
  combination: ManagedCombination,
): AdmissionOutcome {
  const keyed = rowsFor(rows, combination);

  if (combination.providerVersion === null)
    return {
      state: 'refused',
      verdict: 'no-row',
      missing: 'the exact provider version a row would record could not be established',
    };
  if (combination.harnessVersion === null)
    return {
      state: 'refused',
      verdict: 'no-row',
      missing: 'the exact harness version a row would cover could not be established',
    };

  if (keyed.length === 0)
    return {
      state: 'refused',
      verdict: 'no-row',
      missing: `a reviewed config schema and fixture for ${combination.provider} on ${combination.harness} at ${combination.providerVersion} on ${combination.os}`,
    };

  const versioned = keyed.filter((row) => row.providerVersion === combination.providerVersion);
  if (versioned.length === 0) {
    const fixture = keyed[0]?.fixture ?? 'a provider fixture';
    return {
      state: 'refused',
      verdict: 'no-row',
      missing: `a provider fixture covering ${combination.provider} at ${combination.providerVersion} (the nearest row's fixture is ${JSON.stringify(fixture)})`,
    };
  }

  const parsedHarness = parseSemanticVersion(combination.harnessVersion);
  const row = versioned.find((candidate) => {
    const minimum = parseSemanticVersion(candidate.harnessVersion.minimum);
    const maximum = parseSemanticVersion(candidate.harnessVersion.maximum);
    return (
      minimum !== null &&
      maximum !== null &&
      parsedHarness !== null &&
      compareVersions(parsedHarness, minimum) >= 0 &&
      compareVersions(parsedHarness, maximum) <= 0
    );
  });
  if (row !== undefined) return { state: 'admitted', row };

  const verdict =
    parsedHarness === null
      ? null
      : classifyRowHarnessVersion(versioned, combination.harnessVersion);
  if (verdict === null || verdict === 'in-row')
    return {
      state: 'refused',
      verdict: 'no-row',
      missing: `a reviewed config schema and fixture for ${combination.provider} on ${combination.harness}`,
    };
  return {
    state: 'refused',
    verdict,
    missing:
      verdict === 'unknown-newer'
        ? `a harness schema for ${combination.harness} newer than every row's maximum (the newest row names schema ${JSON.stringify(versioned[0]?.configSchema ?? 'none')})`
        : verdict === 'unknown-older'
          ? `a harness schema for ${combination.harness} older than every row's minimum (the oldest row names schema ${JSON.stringify(versioned[0]?.configSchema ?? 'none')})`
          : `a harness schema covering ${combination.harness} at ${combination.harnessVersion}, between the rows that name schemas ${JSON.stringify(keyed.map((entry) => entry.configSchema))}`,
  };
}

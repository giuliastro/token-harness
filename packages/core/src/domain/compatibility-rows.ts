/**
 * RFC 0009 §Compatibility matrix — the row that admits managed mutation.
 *
 * ## A row is evidence, not a semver guess
 *
 * A row records one provider × harness × harness-version-range × provider-version × platform
 * combination that a fixture has actually exercised. It is historical evidence, not a runtime
 * permission list. Ordinary managed setup may continue beyond the recorded tuple when the installed
 * provider explicitly exposes the required runtime capability; the normal ownership, drift,
 * containment, transaction and post-apply verification checks still decide whether the mutation
 * succeeds.
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
 * These verdicts describe only the historical row evidence. They do not by themselves prohibit a
 * managed mutation when a live provider capability probe proves that the required integration
 * surface is still assignable.
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
 * Windows supplied the first reviewed rows. Linux now has an exact Codex 0.152.1 row for HarnessTrim
 * 0.2.1, exact Codex 0.152.1 and 0.153.0 rows for mcptoon 0.7.10, an exact Claude Code 2.1.269 row
 * for mcptoon 0.7.10, and an exact Claude Code 2.1.269 row for GitNexus 1.6.12. GitNexus also
 * exposes a reviewed Codex configuration path, but no exact Codex compatibility recording has
 * been added yet. The mcptoon
 * recordings exercised each owned instruction surface through managed apply, user drift, verified
 * rollback, and surgical uninstall while preserving unrelated user content. The GitNexus recording
 * exercised only the Claude user `mcpServers.gitnexus` JSON entry through the same ownership and
 * rollback machinery; it did not run setup, indexing, or the MCP server. Windows also has live
 * isolated recordings for Claude Code 2.1.251 with RTK 0.44.0 and 0.48.0; both recordings exercised
 * Bash and PowerShell hook entries, drift, verified rollback, and surgical uninstall. None of those
 * points widens a neighbouring row by inference. macOS still has no reviewed mutation row.
 *
 * ## What each row is standing on
 *
 * The harness ranges are points, not spans: one Claude Code or Codex version was observed in each
 * fixture, so one is claimed. A newer one reads `unknown-newer` and refuses, which is a true statement
 * rather than a guess that the next patch behaves the same way.
 *
 * The tiers differ because the evidence does. RTK's row claims `canary`: its history database is a
 * per-harness receipt `verify` can read on the user's machine. HarnessTrim, mcptoon and GitNexus claim
 * `config-only`: HarnessTrim's skills-only install deliberately writes no hook, mcptoon's reviewed
 * integration owns only agent instructions, and GitNexus verification confirms the exact owned JSON
 * entry without starting the MCP server. Its Codex managed path is admitted from live assignability
 * and remains config-only until a separate exact fixture is recorded. A row must not promise a tier
 * `verify` cannot reach.
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
    harnessVersion: { minimum: '2.1.251', maximum: '2.1.251' },
    provider: 'rtk' as ProviderId,
    providerVersion: '0.44.0',
    platform: { os: 'windows', wsl: false, supported: true, limitation: null },
    configSchema: 'claude-settings-json-hooks-powershell',
    fixture: 'tests/fixtures/rows/rtk-claude-windows-2.1.251-0.44.0',
    verificationTier: 'canary',
  },
  {
    harness: 'claude' as HarnessId,
    harnessVersion: { minimum: '2.1.251', maximum: '2.1.251' },
    provider: 'rtk' as ProviderId,
    providerVersion: '0.48.0',
    platform: { os: 'windows', wsl: false, supported: true, limitation: null },
    configSchema: 'claude-settings-json-hooks-powershell',
    fixture: 'tests/fixtures/rows/rtk-claude-windows-2.1.251-0.48.0',
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
  {
    harness: 'claude' as HarnessId,
    harnessVersion: { minimum: '2.1.269', maximum: '2.1.269' },
    provider: 'mcptoon' as ProviderId,
    providerVersion: '0.7.10',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Real Ubuntu/Linux recording: Token Harness owns only the exact mcptoon SKILL.md. Drift
    // refusal, verified rollback and surgical uninstall preserved unrelated Claude settings/skills.
    configSchema: 'claude-skills-directory',
    fixture: 'tests/fixtures/rows/mcptoon-claude-linux-2.1.269-0.7.10',
    verificationTier: 'config-only',
  },
  {
    harness: 'claude' as HarnessId,
    harnessVersion: { minimum: '2.1.269', maximum: '2.1.269' },
    provider: 'gitnexus' as ProviderId,
    providerVersion: '1.6.12',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Real Ubuntu/Linux recording: Token Harness owns only `mcpServers.gitnexus` in the Claude user
    // JSON config. Drift refusal, verified rollback and surgical uninstall preserved unrelated MCP
    // entries and user settings; passive verification did not start the MCP server.
    configSchema: 'claude-user-json-mcp-entry',
    fixture: 'tests/fixtures/rows/gitnexus-claude-linux-2.1.269-1.6.12',
    verificationTier: 'config-only',
  },
  {
    harness: 'codex' as HarnessId,
    harnessVersion: { minimum: '0.152.1', maximum: '0.152.1' },
    provider: 'mcptoon' as ProviderId,
    providerVersion: '0.7.10',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Real Ubuntu/Linux recording: the Token Harness marker is the only owned AGENTS.md region;
    // drift, verified rollback and surgical uninstall were exercised without touching MCP config.
    configSchema: 'codex-agents-md-marker-block',
    fixture: 'tests/fixtures/rows/mcptoon-codex-linux-0.152.1-0.7.10',
    verificationTier: 'config-only',
  },
  {
    harness: 'codex' as HarnessId,
    harnessVersion: { minimum: '0.153.0', maximum: '0.153.0' },
    provider: 'mcptoon' as ProviderId,
    providerVersion: '0.7.10',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Separate real Ubuntu/Linux recording for Codex 0.153.0. Keep this as an exact point: the
    // owned surface is still only the Token Harness AGENTS.md marker, with drift, rollback and
    // surgical uninstall recorded independently for this harness version.
    configSchema: 'codex-agents-md-marker-block',
    fixture: 'tests/fixtures/rows/mcptoon-codex-linux-0.153.0-0.7.10',
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
 * Exact historical-evidence lookup — RFC 0009 §Compatibility matrix.
 *
 * This function answers only whether the observed tuple is represented by recorded fixture
 * evidence. It deliberately does not inspect runtime capabilities. Callers that can prove the
 * required managed surface through a provider capability probe may proceed through the normal
 * transactional safety path even when this lookup returns `refused`.
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

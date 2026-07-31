/**
 * Conflict detection after the fact — RFC 0003 §Continuous conflict detection.
 *
 * > Ownership is resolved when a plan is built, but the configuration it writes lives in
 * > files that other tools and the user can edit afterwards. A second hook added by hand the
 * > next day produces double reduction with nothing to signal it, because every harness in
 * > scope runs all matching hooks rather than only the first.
 *
 * That last clause is the whole reason this exists. Plan-time resolution guarantees one owner
 * *in the plan*; the harness guarantees nothing, because it runs every matching hook. So the
 * one-owner invariant is a claim about the file, and it has to be rechecked against the file.
 *
 * RFC 0003 lists four requirements, and each maps to something here:
 *
 * - `status` and `verify` compare the live configuration against the receipt;
 * - an unowned entry on an exclusive scope is reported as `unowned-entry-on-exclusive-scope`
 *   "with the file, the surface, and the competing command";
 * - the finding is actionable, so the command exits with the problems-found code;
 * - "Token Harness reports it and never silently removes a third party's entry."
 *
 * The last one is why nothing in this module returns an action. It returns findings.
 */

import { formatCapabilityScope, type CapabilityScope } from '../domain/capabilities.js';
import type { DriftFinding } from '../domain/reports.js';
import type { HarnessConfigSummary } from '../domain/manifest.js';
import type { ProviderId } from '../domain/ids.js';
import type { ResolvedCapability } from '../domain/capabilities.js';

/**
 * One competing entry found in a live configuration file.
 *
 * Richer than the `DriftFinding` in `domain/reports.ts`, deliberately. That type is the
 * `status` report's own shape, pinned by a golden transcript, and it carries a single
 * `detail` string. RFC 0003 asks for "the file, the surface, and the competing command" as
 * three separate things, so the detector produces them separately and
 * `toReportedDrift` collapses them at the boundary — rather than the report's contract
 * being widened to whatever the newest detector happens to know.
 *
 * `command` is carried verbatim, redacted only when displayed. RFC 0003 asks for "the
 * competing command" because a user cannot act on "something else is registered here" — they
 * need to recognise the tool.
 */
export interface UnownedEntryFinding {
  code: 'unowned-entry-on-exclusive-scope';
  /** The scope, in `<harness>/<tool-family>/<point>/<capability>` form. */
  scope: string;
  /** The provider Token Harness expects to own it, or null when nothing owns it. */
  expectedOwner: ProviderId | null;
  /** Absolute path to the configuration file holding the entry. */
  configPath: string;
  /** The matcher the entry is registered under, for the surface. */
  matcher: string;
  /** The command string, verbatim. */
  command: string;
  detail: string[];
  remediation: string;
}

export interface DriftInput {
  /** What the resolver decided, or what a receipt recorded. */
  ownership: readonly ResolvedCapability[];
  /** What the harness adapters actually found on disk. */
  configs: readonly HarnessConfigSummary[];
  /**
   * Recognises a command as belonging to a provider. Supplied by the caller because a
   * provider adapter is the only thing that can identify its own invocation — the same seam
   * RFC 0002 uses for detection, and the reason this module parses no configuration.
   */
  identify(command: string): ProviderId | null;
}

/**
 * Finds entries on exclusive scopes that Token Harness does not account for.
 *
 * An entry is reported when it sits on a scope resolved as `exclusive` and its command does
 * not belong to that scope's owner. Two cases are deliberately *not* reported:
 *
 * - an entry whose command belongs to the owner. That is the integration working.
 * - an entry on a scope with no resolved owner. Nothing was promised there, so there is
 *   nothing to have drifted from; a machine where the user wired their own tools and asked
 *   Token Harness for nothing is not in conflict with itself.
 */
export function detectUnownedEntries(input: DriftInput): UnownedEntryFinding[] {
  const findings: UnownedEntryFinding[] = [];

  const exclusiveOwners = new Map<string, { owner: ProviderId; scope: CapabilityScope }>();
  for (const entry of input.ownership) {
    if (entry.mode !== 'exclusive') continue;
    exclusiveOwners.set(formatCapabilityScope(entry.scope), {
      owner: entry.owner,
      scope: entry.scope,
    });
  }

  for (const config of input.configs) {
    for (const point of config.interceptionPoints) {
      for (const matcher of config.matchers) {
        for (const [key, resolved] of exclusiveOwners) {
          if (resolved.scope.harness !== config.harnessId) continue;
          if (resolved.scope.interceptionPoint !== point) continue;
          // The matcher is the harness's own spelling of the tool family, which is how
          // `HarnessToolFamily.id` is defined.
          if (resolved.scope.toolFamily !== matcher) continue;

          for (const command of config.commands) {
            const belongsTo = input.identify(command);
            if (belongsTo === resolved.owner) continue;

            findings.push({
              code: 'unowned-entry-on-exclusive-scope',
              scope: key,
              expectedOwner: resolved.owner,
              configPath: config.configPath,
              matcher,
              command,
              detail: [
                `${key} is an exclusive scope owned by ${resolved.owner}`,
                belongsTo === null
                  ? 'An entry here invokes a command Token Harness does not recognise'
                  : `An entry here invokes ${belongsTo}`,
                'The harness runs every matching hook rather than only the first, so both would transform the same payload and the saving would be counted twice',
              ],
              remediation:
                'Remove the competing entry, or assign the scope to it explicitly with `profile: custom`. Token Harness will not remove a third party’s entry.',
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Collapses a finding into the shape `status` reports.
 *
 * The command is included in `detail` because RFC 0003 requires it to reach the user, and
 * `status` renders `detail` verbatim. It is *not* redacted here: redaction is a display
 * concern with its own policy in `domain/redaction.ts`, and a finding that arrived
 * pre-redacted could not be compared against a configuration file afterwards.
 */
export function toReportedDrift(finding: UnownedEntryFinding): DriftFinding {
  return {
    code: finding.code,
    path: finding.configPath,
    detail: `${finding.scope} also carries ${JSON.stringify(finding.command)} under matcher ${JSON.stringify(finding.matcher)}`,
    remediation: finding.remediation,
  };
}

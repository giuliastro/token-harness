/**
 * Usage text.
 *
 * The command list mirrors RFC 0001 §CLI contract. Commands this build does not
 * carry are shown and marked, rather than hidden: a user who reads `--help` and
 * then types `apply` should already know why it fails.
 */

import type { AvailableCommand } from './argv.js';

const ROOT_USAGE = `token-harness — one control plane for token-efficient coding agents

Usage
  token-harness <command> [flags]

Commands
  doctor      Report detected harnesses and providers
  metrics     Import provider records and report savings by measurement class
  plan        Compute a dry-run plan; nothing is changed
  status      Report applied pipelines, drift, and importer modes
  apply       Not in this build
  verify      Not in this build
  update      Not in this build
  rollback    Not in this build
  uninstall   Not in this build

Flags
  --json               Emit one machine-readable envelope on stdout
  --harness <id>       Restrict the operation to one harness
  --provider <id>      Restrict the operation to one provider
  --project <dir>      Operate on that project instead of the current directory
  --since <window>     Report from this point: a duration like 7d, or a date
  --until <window>     Report up to this point; defaults to now
  --version            Print the version and exit 0
  --help               Print usage and exit 0

Mutating commands are dry-run by default and there is no flag that skips
planning. Exit codes and the JSON envelope are specified in RFC 0006.`;

const COMMAND_USAGE: Readonly<Record<AvailableCommand, string>> = {
  doctor: `token-harness doctor — report detected harnesses and providers

Usage
  token-harness doctor [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when nothing is broken, and 3 when an integration is broken,
an exclusive scope carries an unowned entry, a version is outside its tested
range, or a verification fell below its declared tier. An empty environment is a
state, not a problem.`,
  metrics: `token-harness metrics — report savings by measurement class

Usage
  token-harness metrics [--json] [--since <window>] [--until <window>]
                        [--provider <id>] [--project <dir>]

Imports each provider's own records into the Token Harness state directory, then
reports the window. Providers' records are opened read-only, so measuring cannot
alter what it measures; nothing outside the state directory is written.

--since and --until take a duration (7d, 12h, 2w) or a date (2026-07-22). A date
bound is midnight UTC, so a report is reproducible regardless of the reader's
timezone. The default window is 7d.

Figures are never merged across measurement classes or units: tokens are not
added to characters, and an estimate is not added to an exact figure. A
counterfactual reduction is reported on its own line and never as a saving.
Exits 0 whatever the figures say — an empty report is a fact, not a failure.`,
  plan: `token-harness plan — compute a dry-run plan

Usage
  token-harness plan [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when a plan was produced, and 4 when a hard conflict prevents
apply. Nothing is changed either way.`,
  status: `token-harness status — report applied pipelines, drift, and importer modes

Usage
  token-harness status [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when the live environment still matches the installation
receipt, and 3 when it does not. Drift is reported, never silently repaired.`,
};

export function usageText(topic: AvailableCommand | null): string {
  return topic === null ? ROOT_USAGE : COMMAND_USAGE[topic];
}

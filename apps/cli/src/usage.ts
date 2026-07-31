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
  apply       Execute a plan inside a reversible transaction
  doctor      Report detected harnesses and providers
  metrics     Import provider records and report savings by measurement class
  plan        Compute a dry-run plan; nothing is changed
  status      Report applied pipelines, drift, and importer modes
  verify      Check that an integration actually intercepts, at its declared tier
  rollback    Restore the files a transaction changed, as they were before it
  uninstall   Remove what Token Harness owns, leaving everything else
  update      Not in this build

Flags
  --json               Emit one machine-readable envelope on stdout
  --harness <id>       Restrict the operation to one harness
  --provider <id>      Restrict the operation to one provider
  --project <dir>      Operate on that project instead of the current directory
  --since <window>     Report from this point: a duration like 7d, or a date
  --until <window>     Report up to this point; defaults to now
  --plan <id>          Apply a previously computed plan by id
  --yes                Grant the confirmation a mutating command requires
  --version            Print the version and exit 0
  --help               Print usage and exit 0

Mutating commands are dry-run by default and there is no flag that skips
planning. Exit codes and the JSON envelope are specified in RFC 0006.`;

const COMMAND_USAGE: Readonly<Record<AvailableCommand, string>> = {
  apply: `token-harness apply — execute a plan inside a reversible transaction

Usage
  token-harness apply [--json] [--yes] [--plan <id>] [--harness <id>]
                      [--provider <id>] [--project <dir>]

Dry-run by default: without --yes the plan is computed and displayed and exit 8
is returned, because nothing may change without an explicit decision.

With --plan <id> the stored plan is loaded and revalidated instead of recomputed,
so the artifact that was reviewed is the artifact that runs. It is rejected when
the project, the recorded provider or harness versions, the resolved ownership, or
a precondition digest no longer match — exit 5, before any action executes.

Every file is snapshotted before it is written, including files that did not exist,
so a rollback can restore their absence. Exit 6 means a step failed and the
rollback was verified. Exit 7 means the rollback did not fully restore the files;
it names them and the transaction id, and it leaves a journal in the state
directory. Exit 4 means a hard capability conflict prevents applying at all.

Token Harness only ever removes what it recorded as its own.`,
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
  uninstall: `token-harness uninstall — remove what Token Harness owns

Usage
  token-harness uninstall [--json] [--yes] [--provider <id>] [--project <dir>]

Plans a removal for every entry Token Harness recorded as its own and runs it in
the same transaction machinery as apply, so a failure rolls back.

Surgical, unlike rollback: entries belonging to you or to another tool are left
exactly as they are, and a removal is refused when the entry no longer matches
what was written — an edit of yours blocks the deletion rather than being
overwritten by it.

Providers installed on this machine are not uninstalled. Token Harness removes
the configuration it wrote, never a tool you installed yourself.`,
  verify: `token-harness verify — check that an integration actually intercepts

Usage
  token-harness verify [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only, and passive: it reads receipts the providers already wrote and never
spends a model call. Configuration being present is not evidence that it runs, so
each check reports what was observed rather than what was configured.

Verifies against an installation receipt when there is one, and against the live
configuration when there is not — an installation you configured by hand has no
receipt and is still worth verifying.

Exits 3 only when a check fails, which includes a verification below the tier its
provider declared. An observation that has not happened yet is reported as
not-exercised, which is not a failure.`,
  plan: `token-harness plan — compute a dry-run plan

Usage
  token-harness plan [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when a plan was produced, and 4 when a hard conflict prevents
apply. Nothing is changed either way.`,
  rollback: `token-harness rollback — restore the files a transaction changed

Usage
  token-harness rollback [--json] [--yes]

Reverses the most recent committed transaction from the snapshots it recorded,
then reads the files back to confirm the restoration actually took.

This is time travel for the whole file, not a removal of one entry: anything you
changed in those files since the apply is inside the snapshot too and goes back
with it. Use uninstall to remove only what Token Harness owns.

A transaction that already rolled itself back is not reversed again. One left
dirty is refused, because its journal no longer describes what is on disk and
writing more bytes over it would make it less recoverable.`,
  status: `token-harness status — report applied pipelines, drift, and importer modes

Usage
  token-harness status [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when the live environment still matches the installation
receipt, and 3 when it does not. Drift is reported, never silently repaired.`,
};

export function usageText(topic: AvailableCommand | null): string {
  return topic === null ? ROOT_USAGE : COMMAND_USAGE[topic];
}

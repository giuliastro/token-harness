/**
 * Usage text.
 *
 * The command list mirrors RFC 0001 §CLI contract.
 *
 * Ordered by the sequence a person would actually use, not alphabetically, and preceded by that
 * sequence spelled out. `--help` was reported as unusable by a first-time user: it listed nine
 * commands with no indication of which to run first, or which of them would touch their machine.
 * A reference for someone who already knows the tool is not the same document as an answer to
 * "what do I do now", and the second one has to come first.
 *
 * The write/writes-nothing column is there because that was the other thing nobody could tell.
 */

import type { AvailableCommand } from './argv.js';

const ROOT_USAGE = `token-harness — maximize useful Claude Code and Codex subscription capacity

First time here
  1  token-harness doctor        what is on this machine        writes nothing
  2  token-harness budget        quota remaining                writes nothing
  3  token-harness context       static context cost            writes nothing
  4  token-harness mcp           MCP audit                     writes nothing
  5  token-harness history       local usage history            writes nothing
  6  token-harness optimize      quota-aware advice             writes nothing
  7  token-harness plan          what would change              writes nothing
  8  token-harness apply --yes   make those changes             WRITES
  9  token-harness verify        is it actually intercepting    writes nothing
 10  token-harness metrics       what it saved                  writes nothing
 11  token-harness benchmark     compare paired task receipts   writes nothing
 12  token-harness benchmark-start snapshot before a task       writes state only
 13  token-harness benchmark-finish close task receipt          writes state only

  Steps 1 through 7 are safe to run right now. Nothing changes until step 8.

Usage
  token-harness <command> [flags]
  token-harness help <command>

Commands, in the order you would use them
  doctor      What is installed, what is wired up, what is worth knowing
  budget      Read Claude/Codex usage windows with explicit source/confidence
  context     Audit instruction bytes, effective config, MCP servers and tools
  mcp         Show the focused native MCP/server/tool inventory
  history     Read local Claude/Codex usage history through ccusage
  plan        Compute what would change, file by file. Changes nothing
  apply       Run that plan inside a transaction that can be rolled back
  verify      Check the pipeline actually intercepts, at its declared tier
  metrics     Report what was saved, labelled with how it was measured
  benchmark   Compare baseline/optimized task receipts with quality gates
  benchmark-start
              Snapshot quota/policy before one benchmark task into local state
  benchmark-finish
              Close that capture with quota-after and an explicit quality gate
  optimize    Combine quota and context evidence into read-only policy advice
  status      Report applied pipelines, drift, and importer modes
  update      Update installed providers to what their channel offers
  rollback    Restore the files a transaction changed, as they were before
  uninstall   Remove what Token Harness set up, leaving everything else

Flags
  --json               Emit one machine-readable envelope on stdout
  --harness <id>       Restrict the operation to one harness
  --provider <id>      Restrict the operation to one provider
  --project <dir>      Use that project instead of the current directory
  --since <window>     Report from this point: a duration like 7d, or a date
  --until <window>     Report up to this point; defaults to now
  --plan <id>          Apply a previously computed plan by id
  --baseline <file>     Baseline task benchmark receipt JSON
  --optimized <file>    Optimized task benchmark receipt JSON
  --benchmark-id <id>    Safe local id for benchmark start/finish
  --variant <name>       Benchmark variant: baseline or optimized
  --quality <result>     Finish quality gate: passed or failed
  --attempts <count>     Total attempts used to complete the task
  --failed-attempts <n> Failed attempts before the final outcome
  --task <class>        Optimizer task: mechanical, standard, hard, critical
  --profile <name>      Optimizer profile: economy, balanced, quality, custom
  --reserve <percent>   Keep this percent of observed allowance in reserve
  --native-policy       Add reversible native Codex policy edits to plan
  --yes                Grant the confirmation a mutating command requires
  --version            Print the version and exit 0
  --help               Print usage and exit 0

Only apply, update, rollback and uninstall change harness/provider configuration,
and none of them do without --yes. Metrics and benchmark capture may write only
Token Harness's own local state. Exit codes and JSON are specified in RFC 0006.`;

const COMMAND_USAGE: Readonly<Record<AvailableCommand, string>> = {
  'benchmark-start': `token-harness benchmark-start — snapshot one task before it runs

Usage
  token-harness benchmark-start --benchmark-id <id> --variant <baseline|optimized>
                                --task <class> --harness <claude|codex>
                                [--project <dir>] [--json]

This command does not execute the task or change harness configuration. It records
the current discovered model/effort/verbosity and current usage windows into Token
Harness's state directory. The raw project path is not stored in the capture; only
the machine-local stable project id is persisted.

An existing capture or completed receipt is never overwritten. Missing live quota
is recorded as an empty window list rather than inferred from local tokens.`,

  'benchmark-finish': `token-harness benchmark-finish — close a started task receipt

Usage
  token-harness benchmark-finish --benchmark-id <id> --variant <baseline|optimized>
                                 --quality <passed|failed> --attempts <n>
                                 --failed-attempts <n> [--project <dir>] [--json]

Run this after the benchmark task. It requires the capture from benchmark-start,
verifies it belongs to the same project, observes quota again, and writes an
immutable schema-1 receipt under Token Harness state.

This first capture slice does not guess local token totals or runtime error
correlation; localUsage remains null and errorCodes remains empty. Those fields
will be populated only when a trustworthy task-level correlation exists.`,

  benchmark: `token-harness benchmark — compare paired task receipts

Usage
  token-harness benchmark --baseline <receipt.json> --optimized <receipt.json>
                          [--json] [--project <dir>]

Read-only. The command reads two schema-1 task receipts and applies the deterministic
RFC 0011 comparator. Both receipts must carry explicit quality gates. Quality is
evaluated before efficiency; only matching authoritative/reported backend windows
that do not cross a reset are compared as subscription quota.

If backend quota is not comparable, failed attempts, runtime/provider errors,
attempt count and local token volume may separate the receipts as local evidence.
Local tokens are never relabelled as subscription quota. A malformed receipt,
unsupported schema or wrong baseline/optimized role is rejected rather than guessed.`,

  history: `token-harness history — read local Claude/Codex usage history

Usage
  token-harness history [--json] [--harness <id>] [--project <dir>]
                        [--since <window>] [--until <window>]

Read-only. Uses an already installed ccusage 20.x and forces --offline --no-cost.
Token Harness does not install ccusage, fetch pricing, or include estimated API
costs. Claude and Codex history stays separate from live subscription quota.

The default window is 7d. Local token volume can describe a recent burn trend
and a conservative most-recent-session boundary signal, but neither is assumed
to represent the active session or converted into provider allowance percentage
or subscription spend. Missing ccusage, an unsupported major, and unreadable
history are explicit states rather than zero usage.`,

  mcp: `token-harness mcp — inspect MCP servers and exposed tools

Usage
  token-harness mcp [--json] [--harness <id>] [--project <dir>]

Read-only. Uses the same native inventory as token-harness context. Codex reports
server status, auth state and native tool counts when app-server exposes them.
Claude reports the server inventory from claude mcp list and keeps per-server
tool counts unknown rather than guessing. The assessment section classifies only
known tool exposure and observable status/auth health. High tool count is never
treated as evidence that a server is irrelevant or removable. A question mark
means unknown, not zero.`,

  optimize: `token-harness optimize — explain how to spend the current allowance

Usage
  token-harness optimize [--json] [--harness <id>] [--project <dir>]
                         [--task <class>] [--profile <name>] [--reserve <0-95>]

Defaults to --task standard --profile balanced --reserve 20. The command is
read-only. It combines live budget windows with context/MCP inventory and emits
ordered recommendations with the observations that caused them.

Pacing is calculated only when used percentage, duration, and reset are known.
Model names are never ranked by inference: a model switch is not recommended
until benchmark evidence exists. Reasoning effort is selected only from levels
advertised by the current discovered model. When ccusage session history exists,
the most recently observed session may produce conditional new-session/compact
advice; it is never assumed to be the active session. MCP advice can flag a
non-working server or a high-exposure hotspot, but never recommends removal
without task-relevance or usage evidence. The custom profile currently requires
an explicit --reserve and otherwise keeps the task quality-floor rules.`,

  context: `token-harness context — audit context overhead before spending quota

Usage
  token-harness context [--json] [--harness <id>] [--project <dir>]

Read-only. Codex uses config/read and mcpServerStatus/list from its app-server,
then mirrors AGENTS.md discovery from project root to the selected working
directory. Claude uses its native mcp list command; CLAUDE.md file sizes are
reported as candidates because this command cannot prove their admitted bytes.

Bytes, MCP servers and tool counts remain separate measurements. A question mark
means unknown, never zero. Instruction contents are never printed.`,

  budget: `token-harness budget — read current subscription usage windows

Usage
  token-harness budget [--json] [--harness <id>] [--project <dir>]

Read-only. Codex uses its native app-server rate-limit RPC when available.
Claude prefers a future fixture-proven native surface; until then Token Harness can
delegate to an already-installed cclimits companion only when it supports the
cacheless JSON observer flags. Token Harness never reads Claude OAuth credentials
itself and never installs cclimits.

Companion OAuth readings are labelled reported. A fresh Claude local cache is
labelled cached and is displayed but never used for live pacing; stale cache is
rejected. Five-hour, weekly and unknown buckets stay separate. A local token count
is never converted into a subscription percentage. Reset-credit inventory may be
reported, but this command cannot redeem or consume credits.`,
  apply: `token-harness apply — execute a plan inside a reversible transaction

Usage
  token-harness apply [--json] [--yes] [--plan <id>] [--harness <id>]
                      [--provider <id>] [--project <dir>] [--native-policy]
                      [--task <class>] [--profile <name>] [--reserve <0-95>]

Dry-run by default: without --yes the plan is computed and displayed and exit 8
is returned, because nothing may change without an explicit decision.

With --plan <id> the stored plan is loaded and revalidated instead of recomputed,
so the artifact that was reviewed is the artifact that runs. Without --plan,
--native-policy recomputes the same reversible Codex effort/verbosity policy
described by token-harness plan --native-policy before confirmation. It is rejected when
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

For safely attributable pipeline channels, the channel row also reports
raw-to-final payload volume before and after optimization. Because the channel
names the harness and tool family, this is the supported tool-output-by-family
view; Token Harness does not sum independently measured channels into a fake
cross-family total.

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
  update: `token-harness update — update the providers already installed

Usage
  token-harness update [--json] [--yes] [--provider <id>] [--project <dir>]

Asks each provider's installation channel what version it offers and compares it
with what is installed. Dry-run by default: without --yes the comparison is shown
and exit 8 is returned. The version the run would install is the exact version the
dry run reported, not whatever is newest when it executes.

Reaching the channel is a network read, and it happens on a dry run too, because a
target version cannot be named without asking. The destinations are reported.

Updates only. A provider that is not installed is left alone — installing one is
plan's business, and an update that silently installed would be an install nobody
reviewed as one. A channel offering something older is not acted on either.

A pinned provider is skipped and its pin is named. That is not a problem and does
not change the exit code. A pin written inside a project is reported and not
honored: a repository may not choose which version of a tool you run.

An updated package is not restored by a rollback. Rollback restores files, and a
package is not a file, so the report says so rather than implying otherwise.`,
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
                     [--native-policy] [--task <class>] [--profile <name>]
                     [--reserve <0-95>]

Read-only. Exits 0 when a plan was produced, and 4 when a hard conflict prevents
apply. Nothing is changed either way.

--native-policy adds reviewed Codex native settings derived from the same optimizer
policy as token-harness optimize. This build manages reasoning effort and verbosity
only. A field coming from project config or a selected profile is left untouched.
The resulting config/batchWrite action carries Codex's observed user-config version,
is snapshotted before mutation, and can be executed later with apply --plan <id> --yes.`,
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

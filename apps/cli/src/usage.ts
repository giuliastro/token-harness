/**
 * Usage text.
 *
 * The advanced command list mirrors RFC 0001; RFC 0006's onboarding amendment adds setup/ui.
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

const ROOT_USAGE = `token-harness — simple Claude Code and Codex efficiency

New here? Open the application
  token-harness

Review setup, approve changes and see recorded savings in the browser.
No command copying or plan IDs. Keep using your coding agent normally.
An AI may use the CLI, but is not required to operate Token Harness.

Usage
  token-harness
  token-harness <command> [flags]

Everyday commands
  start       Open the guided local application (same as no command)
  savings     Recorded output savings across all locally recorded projects
  setup       Guided detection, safe configuration, and verification
  ui          Open the guided local application in your browser
  optimize    Show the best evidence-based action for the current task
  status      Show active harnesses, providers, and configuration health

Advanced commands
  doctor      Full installation and connection check
  budget      Claude/Codex subscription usage windows
  context     Instruction, model, and context-cost observations
  mcp         MCP server and tool inventory
  history     Local usage history through an installed ccusage
  plan        Prepare an exact, reversible change without applying it
  apply       Apply a reviewed plan
  verify      Check that configured integrations work
  metrics     Show measured savings
  update      Check or update installed providers
  rollback    Restore the previous configuration
  uninstall   Remove only configuration Token Harness owns
  benchmark, benchmark-start, benchmark-finish, benchmark-matrix
              Compare real task results for advanced evaluation

Useful flags
  --verbose            Show technical details instead of the short summary
  --json               Emit the complete machine-readable result
  --yes                Confirm a configuration-changing operation
  --harness <id>       Restrict the operation to one harness
  --provider <id>      Restrict the operation to one provider
  --project <dir>      Use that project instead of the current directory
  --help               Show help for a command
  --version            Print the version

Run token-harness <command> --help for advanced flags and safety details.`;

const COMMAND_USAGE: Readonly<Record<AvailableCommand, string>> = {
  setup: `token-harness setup — guided onboarding in one command

Usage
  token-harness setup [--yes] [--verbose] [--json] [--project <dir>]

Without --yes, setup detects Claude Code/Codex, checks existing providers, and
prepares any supported reversible configuration. It changes no harness/provider
configuration and ends with one next step.

Run the suggested token-harness setup --yes only after reviewing the short plan.
It applies that stored plan transactionally, verifies the result, reads allowance
when available, and points to the local dashboard. Token Harness never installs
Claude Code or Codex and never spends model quota during setup.`,
  'benchmark-start': `token-harness benchmark-start — snapshot one task before it runs

Usage
  token-harness benchmark-start --benchmark-id <id> --variant <baseline|optimized>
                                --task <class> --harness <claude|codex>
                                [--project <dir>] [--json]

This command does not execute the task or change harness configuration. It records
the current discovered model/effort/verbosity and current usage windows into Token
Harness's state directory. When compatible ccusage history is available it also
snapshots cumulative session counters for conservative finish-time subtraction.
The raw project path is not stored in the capture; only the machine-local stable
project id is persisted.

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

When ccusage 20.x is available, start and finish snapshot cumulative session
counters and record localUsage only when exactly one harness session changed
inside the task boundary. Parallel changed sessions remain ambiguous and leave
localUsage null. Local tokens remain local evidence, never subscription quota.
Runtime errorCodes remain empty until trustworthy task-level correlation exists.`,

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

  'benchmark-matrix': `token-harness benchmark-matrix — summarize real paired task evidence

Usage
  token-harness benchmark-matrix [--json] [--project <dir>]
                                 [--harness <claude|codex>] [--task <class>]

Read-only. Scans completed benchmark pairs in Token Harness local state, requires
their captures to bind both variants to the current project, and applies the same
deterministic comparator used by token-harness benchmark.

The report groups mechanical, standard, hard and critical tasks; counts optimized
wins, baseline wins, equal and inconclusive results; and keeps quota-backed,
local-evidence and quality-only outcomes separate. Local token totals are summed
only across quality-passed pairs where both variants have attributable local
usage. Backend
quota percentages from different windows are never summed and no composite score
is invented.`,

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
--native-policy recomputes the same reversible native preference policy
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
is snapshotted before mutation, and can be executed later with apply --plan <id> --yes.

With --harness claude, an explicit --task is required. On reviewed Claude versions,
only the persisted user effortLevel preference is managed. Project, environment and
thinking overrides block mutation. Managed policy and running-session overrides
may still win: reopen Claude and inspect /effort. This is config-only verification.
Rollback restores exact file bytes; uninstall restores only the owned preference.`,
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

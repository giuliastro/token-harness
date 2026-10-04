# RFC 0013: Guided local efficiency experience

- Status: Accepted for this implementation
- Date: 2026-09-05

## Product decision

The default experience is a local application, not a sequence of diagnostic commands.
`token-harness` and `token-harness start` open it. Users review a plain-language setup,
approve it once, then keep using their coding agents normally. The configured providers
operate through their existing integrations; no permanent supervisor or AI account is required.
An AI may use the stable CLI, but is not a prerequisite and cannot bypass review or trust.

The three primary questions are: what is configured, what has been measured, and which
rules are responsible. Task-specific reasoning is optional and explicitly persistent;
setup never guesses a task or silently lowers reasoning quality. No automatic model,
billing, authentication, trust or MCP removal changes are introduced.

## Local control boundary

This adds an explicitly reviewed local browser control surface, not a remote mutation API.
RFC 0010's external read-only seam remains unchanged. `ui --read-only` retains the old
read-only dashboard, and `ui --json` retains its schema-1 report.

The interactive server binds only to 127.0.0.1. Every request must match its exact Host
(including port) and loopback peer. Cross-site and cross-origin requests are rejected.
Writes additionally require exact Origin, JSON content type, a bounded body, and a
cryptographically random per-process CSRF token obtained through a same-origin read.
No CORS allowance, arbitrary argv, file path, shell string, project or executable is accepted.
Security headers include a restrictive CSP and frame-ancestors none.

A preview produces a short-lived, single-use random approval ticket tied to exact stored
plans. The browser submits the ticket, never a plan's contents. Apply executes the stored
plans through the existing validation, backup, ownership, rollback and verification pipeline.
Concurrent operations are serialized; duplicate and expired approvals are rejected. A new
preview invalidates an old ticket. No write happens on page load, refresh, or a GET request.
The automatic startup update check is a passive read outside the managed-operation lock.
It coalesces concurrent startup checks, creates no approval, and never replaces an existing ticket.
If a managed operation starts during the read, its evidence is discarded. Choosing Review update
performs a fresh serialized interactive check before an installation ticket can be created.
Multiple harness plans are separate transactions: partial success is reported explicitly,
not called an atomic group. Unsupported combinations remain blocked and explained.

## Measurement semantics

### October 4 evidence clarity and paired-window repair

Results distinguish current allowance observations, runtime routing activity and demonstrated
savings. Coding-app evidence includes its explicitly attributed optimizer rows, native routing
callbacks and current allowance readings; configuration never assigns shared output to an app.
Routing activity also remains a separate searchable Evidence source. A runtime callback is
execution evidence, not a token or subscription saving. Current quota readings show their source,
reset and missing-data reason independently of paired savings.

All-project reducer reports add optional `byHarness` provider rows computed from each event's
explicit harness identity, before aggregation. App rows consume these scoped figures rather than
the overall provider totals' list of contributing apps. Shared/unknown events remain in overall
provider evidence only. Legacy reports without the breakdown do not prove an app-specific amount.

The benchmark matrix retains every comparable quota window in additive `quotaComparisons`,
while preserving the existing primary `quota` field and comparison verdict. Five-hour and weekly
results are evaluated separately, including negative deltas. Additive `quality` carries the
baseline and optimized gates so passing checks remain visible even when usage is unavailable.
Unknown or failed gates cannot imply preserved quality. Attributed routing with passing quality
but no measured usage remains unmeasured for savings. Empty states identify missing comparisons
and link to the existing benchmark-start/finish measurement workflow; ordinary usage alone does
not create a baseline or evaluate quality. Reducer history remains all-project and period-filtered;
quota/quality comparisons remain current-project and live callbacks/current quota have their own
observation dates, independent of the reducer period.

`savings` reports all locally recorded projects by default, independent of the directory
from which the dashboard was opened. The existing `metrics` command stays project-scoped.
An internal all-project mode imports records through existing providers and keeps measurement
classes, units, providers and counterfactuals separate. All-time means available retained
history, including history recorded before Token Harness was installed, not guaranteed lifetime
usage. Dates and missing telemetry are explicit. No invented token-to-quota or euro conversion.

The UI does not add provider totals together. It shows each recorded reducer result with its
class and unit, and excludes simulations from realized savings. Before/after values refer only
to changed recorded payloads, not the whole coding session. Negative savings remain negative.
Quota windows are separate observations, never evidence that the same percentage was saved.

## UI specification

Dependency-free browser UI using semantic HTML, existing Node server and embedded assets.
No new frontend runtime dependency. One main heading, responsive single-column mobile layout,
native confirmation dialog, visible keyboard focus, live progress/errors, and empty states.
The September 6 clarity revision uses neutral graphite/mint tokens, solid surfaces and
system/light/dark themes, independent of a corporate design system. New components: results panel, rule disclosures, review dialog and activity report.
The new surface is operational UI, not a marketing landing page.

Rules have explicit modes: automatic integration, persistent user preference, observation,
or not enabled. Configured is not relabeled as proven runtime activity. Current preferences
are read again after applying; a browser session activity list records successes and refusals.

## Acceptance

### October 3 foreground maintenance and evidence layout

The browser checks update channels once after the first overview load and offers the existing
exact-version approval flow when an update is available. It does not install on page load.
After an approved update, health checks run automatically. A verified global npm self-update
offers **Restart and re-check**: the server revalidates the installed target, launches the same
canonical entry with the current Node executable, and waits for a new loopback listener over IPC.
The browser receives only that listener URL; no client-supplied command, path or port is accepted.
If startup fails the existing dashboard stays open. The new process collects fresh health and
capability observations. The existing package transaction provides rollback of the update.

Optimizer actions, including ownership-aware removal and prerequisite installation guidance,
share one setup list. Results use a compact dashboard above one searchable, filterable, sortable
evidence list with expandable provenance. Unlike classes and units remain separate. Activity is
retained to 30 events and displayed in a bounded scrolling region.

- No command copying or plan IDs in the primary browser workflow.
- Setup and optional task settings can be reviewed and applied in the browser.
- All-project recorded savings visible without manually running metrics.
- Current rules and measurement limitations explained next to their state.
- Browser authentication, replay/concurrency, empty/error and multi-harness tests.
- Existing CLI/JSON, ownership and compatibility tests remain green.


## Guarded undo

The dashboard remembers the last successful plan from its own process. An undo preview warns
that complete files, including later manual edits, are restored. The existing rollback command
now accepts its existing `--plan` selector as an expected latest-plan guard, refusing a newer
unrelated transaction instead of undoing it. No historical arbitrary transaction is selectable
from the browser. Multi-agent application remains separate transactions; one undo reverses
only the last successful one. Closing the dashboard clears this in-memory shortcut, not backups.


## September 6 clarity revision

The interface groups Overview, Rules & settings, and Activity into accessible tabs.
Agent-level actions either open a reviewed task preview or explain the specific native
manual step. Observed state is separate from behavior and next steps. Reading a recognized
saved Claude effort no longer requires a reviewed write version; mutation admission is
unchanged. Missing, unreadable and overridden preferences remain distinct. See
`docs/spikes/dashboard-clarity.md` for the UI and observation contract.

## Progressive observation and voluntary sharing (2026-09-06)

Observation progress is data, not a simulated timer. Five read stages (agent inventory,
allowance, preferences/tools, reduction records and configuration status) report working,
ready or attention through the existing protected `/api/activity` endpoint. Projected agent
cards and savings become visible as their inputs arrive. Pending preference/allowance fields
are not mislabeled unavailable. A failed observer does not discard other completed readings.
No additional subprocesses are launched by a progress poll. The UI exposes animation, named
stages, elapsed waiting text, errors and reduced-motion alternatives. A completed configuration
read is never presented as runtime interception proof. During a mutation, progress names the
actual operation; internal transaction substeps are not fabricated.

Impact percentages use one provider/class/unit row's comparable before/after volumes for the
same recorded changed outputs. Increases contribute to that row's net result. Missing or
inconsistent baselines, non-finite counts and simulations receive no percentage/share claim.
Estimates remain labeled in the UI, text and image. Near-total reductions with nonzero output
are never rounded to 100%. Provider rows are not summed or relabeled as subscription savings.

Sharing is an explicit client-side action following a frozen preview. It exports only an
allowlisted provider name, numeric aggregates, measurement class, reporting window, limitation
text and the public project URL. No paths, prompts, accounts, allowance balances, private IDs
or session tokens are exported. No social SDK, tracking pixel, webhook, credential or remote
upload is introduced. X opens a short post draft; Reddit opens its composer with title/link
(the longer summary must be pasted for a text post); Discord uses copy-and-paste. PNG cards
are rendered locally from the same snapshot. Clipboard/native-share failures offer manual
copy, and downloads do not imply an uploaded attachment or published post. Existing loopback,
Origin, CSRF, approval and transaction boundaries remain unchanged.

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
Multiple harness plans are separate transactions: partial success is reported explicitly,
not called an atomic group. Unsupported combinations remain blocked and explained.

## Measurement semantics

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
Dark HSL tokens, translucent content surfaces and solid dialog surfaces follow the UI token
contract. New components: results panel, rule disclosures, review dialog and activity report.
The new surface is operational UI, not a marketing landing page.

Rules have explicit modes: automatic integration, persistent user preference, observation,
or not enabled. Configured is not relabeled as proven runtime activity. Current preferences
are read again after applying; a browser session activity list records successes and refusals.

## Acceptance

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

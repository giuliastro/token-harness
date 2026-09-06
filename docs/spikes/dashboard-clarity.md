# Dashboard clarity and read-only effort observation

Date: 2026-09-06. This is a product UI, not a marketing landing page.

## What was wrong

`readClaudeNativeEffort` returned null before inspecting settings whenever the CLI
version was not exactly 2.1.261. The UI also rendered an absent `effortLevel` as
"Not observed". An unknown write contract, an unreadable preference and no saved
preference were therefore presented as the same state. The old rule's "Evidence"
was a behavior description, not evidence about the user's configuration.

## Observation and mutation are separate

A recognized user preference can now be read on other CLI versions, while automatic
writes remain restricted to the existing reviewed version and CLI/environment/file
preconditions. No new provider or native-write compatibility version was admitted.

The report distinguishes a saved preference, no saved preference, and a preference
that could not be read. Environment/project overrides do not hide the saved value;
they still block a write. A custom configuration root is explained, not guessed.
Unknown values, file errors and private paths are not exposed in the guided report.
The saved user value is never represented as the active session's effective value.

Source contract checked against first-party documentation:

- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/commands
- https://developers.openai.com/codex/cli/slash-commands

Those docs justify observing the field and showing native controls. They do not
constitute a fixture proving transactional writes on an additional CLI version.

## UI structure

- **Overview:** compact agent cards, contextual reasoning/allowance actions and recorded
  savings. No marketing hero or full rule catalogue above the results.
- **Rules & settings:** one agent at a time, plus a separate decision/safety group.
  Each rule exposes an action before its optional details. Details distinguish
  what was observed, how the behavior is applied, and what the user can do.
- **Activity:** verification and guarded undo, together with their session log.

Reasoning opens a task preview when the current scope is safely writable. Otherwise
"Change in Claude" or "Change in Codex" explains the specific blocker and the native
command, including where to run it. Clipboard actions only copy; they never execute.
Connected tools, missing allowance companions and missing measurements have their
own help. An optional AI prompt is provided for inspecting HarnessTrim telemetry;
it asks for review and does not assert automatic installation or measured savings.

## Visual and interaction contract

Neutral graphite/mint tokens replace the previous corporate navy/purple gradient.
System/light/dark themes, no remote assets, no additional runtime dependency. The
existing semantic HTML and native dialog are retained. Desktop uses two agent cards
and compact savings rows; mobile uses one column and 44px controls. Three top-level
tabs support arrow keys, Home/End, visible focus and explicit panel labels. Refresh
preserves opened rule details and focus, and does not replace an open review dialog.
Theme changes do not animate button backgrounds to avoid transient contrast loss.

No new mutation endpoint, shell execution, credential access, model switching or
silent reasoning downgrade is added. The loopback/Host/Origin/CSRF boundary and
single-use approval tickets are unchanged. Refresh renews the per-process session
token so restarting the server does not leave the UI in an unrecoverable stale-token
loop.

## Validation boundary

Unit and real temporary-filesystem integration tests cover observation versus writes,
missing/malformed settings, project/environment overrides, UI action selection and
privacy. Existing review/apply/rollback and HTTP-security tests remain authoritative.

Visual tests use Chromium with synthetic observations produced through the local
service/HTTP handler. Browser network navigation is administratively blocked in the
test environment, so the browser is rendered offline with those captured fixtures.
This validates layout and client interactions, not an authenticated agent session
or real account savings. Screenshots and test reports label their data as synthetic.

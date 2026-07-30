# RFC 0007: Live verification mechanism

- Status: **Proposed** — the other six RFCs are Accepted; this one is not, because
  acceptance is not the author's act.
- Date: 2026-07-30
- Evidence: `docs/spikes/2.5-live-verification-log.md`

## Purpose

RFC 0002 §Verification tiers defines three tiers and names tier 3 the target, then
defers the mechanism: "The concrete sentinel mechanism for each harness is the subject
of the Phase 2.5 spike, whose result becomes RFC 0007."

This is that result. It specifies what a receipt is, what a sentinel must be, what a
tier means, and the clauses the harness adapter contract inherits. Every normative
statement below traces to something observed on a real machine; the spike log records
the invocations, including the ones that failed.

The most important thing the spike established is negative, so it goes first.

## Configuration presence is not evidence

RFC 0002 already says "a tier-2 result is never presented as proof of interception".
That was an argument. It is now a demonstrated fact, and the demonstration changes what
an adapter must do rather than merely how carefully it must speak.

On the spike machine, `~/.codex/hooks.json` contained a well-formed `PostToolUse` entry,
matcher `^Bash$`, pointing at an installed provider. The provider never ran. Six
invocations, including ones with the sandbox disabled and hook trust bypassed, executed
the command successfully and produced no receipt.

The cause is that Codex tracks hook **enablement** as persisted state, separate from the
configuration that declares the hook, and separate again from trust. The binary carries
a `HookStateToml` with `enabled` and `trusted_hash` fields, a message about "updating
hook enablement in TUI", and trust states `Untrusted | Trusted | Modified`. The
`--dangerously-bypass-hook-trust` flag says what it does precisely: "**Enabled** hooks
may run without review" — it waives review of an enabled hook, it does not enable a
disabled one.

Three consequences are normative:

1. **An adapter must read enablement state, not only configuration.** A harness that
   distinguishes "declared" from "active" makes those two different questions, and
   `doctor` answering the first while reporting the second is the failure mode this RFC
   exists to prevent.
2. **Verification must be able to report `declared but not active`.** That is neither a
   pass nor a broken integration; it is a state a user has to be told about, because the
   remedy is theirs.
3. **Editing an owned hook can disable it.** Enablement is pinned to a hash of the hook's
   content, so a marker-block or JSON-merge edit to a hook that is currently enabled
   changes the hash and returns it to `Modified`. An adapter that edits an active hook
   must re-check enablement afterwards and report if the edit deactivated what it was
   configuring. This interacts directly with the ownership model in RFC 0004 §Ownership:
   owning an entry and keeping it live are not the same guarantee.

## What a receipt is

A receipt is an observation that survives the operation. There are two families, they
prove different things, and an adapter declares which it uses.

| Family | Source | Proves |
| --- | --- | --- |
| **Harness event stream** | the harness's own machine-readable output, e.g. `codex exec --json` emitting `command_execution` items | *what the harness actually ran*, so a command rewrite is directly observable |
| **Provider telemetry** | the provider's own records, e.g. RTK's analytics, HarnessTrim's `TrimEvent` JSONL | *that the provider executed*, and with what measured effect |

For `shell.command.rewrite` the event stream is the stronger evidence: the rewritten
command is visible without asking the provider anything. For `shell.output.reduce` the
provider's telemetry is the only source that carries the before and after figures RFC
0005 needs.

### The agent's own report is never a receipt

In one spike run the sentinel command failed inside the harness's sandbox and the model
replied `DONE` regardless. Only the `command_execution` item, with its `exit_code` and
captured output, distinguished the two outcomes.

Verification reads the event stream or the provider's records. It never reads the
assistant's summary, and an adapter that parses agent prose to decide a check has passed
is a defect regardless of how well the prose reads.

## What a sentinel must be

RFC 0002 asks for a sentinel "whose transformation is unambiguous". PLAN §2.5 adds
"cheap, and free of side effects". The spike found those pull against each other, and
adds two constraints neither document anticipated.

1. **An executable, never a shell builtin.** `echo` is not a program. The first spike run
   failed with `CreateProcessAsUserW` error 2 because the interception point may execute
   the sentinel without a shell — the same rule RFC 0004 §Process policy imposes on Token
   Harness, now imposed on Token Harness *by* the harness.
2. **It must guarantee a receipt.** HarnessTrim records "a TrimEvent per *reduction*", so
   the cheapest possible sentinel — minimal output, nothing to reduce — produces no
   receipt even when the hook fires. Against a reducing provider the sentinel must emit
   output the provider will demonstrably transform. Cheap and observable are in tension,
   and observable wins.
3. **It must be attributable.** A receipt that could have come from the user's own
   concurrent work proves nothing. Attribution uses whatever the receipt family offers,
   in this order: a nonce carried in the command when the event stream records commands;
   the byte offset of the provider's log before and after, which is the cursor mechanism
   RFC 0005 already defines; and the expected payload size, since RFC 0005 forbids storing
   command text in an event.
4. **Side-effect-free.** Reading, never writing. The spike used a read-only `git` command
   and a `node -e` that writes only to stdout.

## Active and passive canaries

RFC 0002 describes one mechanism: Token Harness "causes the harness to run an operation".
The spike found two, with different costs and different meanings.

| | How the operation happens | Cost | Answers |
| --- | --- | --- | --- |
| **Active** | Token Harness drives the harness headlessly — `codex exec`, and the equivalent elsewhere | a model call: 32k input tokens, measured | "is interception working *now*" |
| **Passive** | Token Harness reads the receipt of an operation the harness performed anyway | free | "was interception working as of the last observed operation" |

Both are tier 3: both observe a real operation traversing the interception point. They
differ in what they can conclude.

Normative rules:

- **`verify` defaults to passive.** RFC 0006 makes `verify` read-only and routine, and a
  32k-token model call per invocation is not compatible with routine. A command that
  costs real money every time it runs is a command users stop running.
- **An active canary is explicitly requested.** It never happens as a side effect of a
  read-only command.
- **A passive canary with no observed operation is not a pass.** It reports
  `not-exercised`, which is distinct from both pass and fail: nothing is known yet. An
  adapter that returned `pass` because it found no contradiction would be asserting on no
  evidence.
- **A passive receipt carries the time of the operation it observed.** "Working as of
  three weeks ago" and "working as of a minute ago" are different claims and the receipt
  states which it is.

## A tier is per harness, per version, and per tool family

RFC 0002 says per harness and per capability. RFC 0002 §Harness versioning is symmetric
adds the version. The spike adds the third axis, and it is not a refinement — it is a
coverage hole large enough to invalidate a savings report.

On the spike machine, Claude Code's hook matched `Bash`. The identical command routed
through the harness's **PowerShell** tool produced no receipt at all: the provider never
saw it. That is the default tool family for a Windows user.

- RFC 0003 already scopes a capability as `<harness>/<tool-family>/<point>/<capability>`,
  so an uncovered tool family is an **unowned scope**, reportable by the existing model.
- **An adapter enumerates the tool families its harness exposes**, and verification
  compares the provider's matcher against that list. A matcher covering one family is a
  correctly installed, correctly verified, and largely ineffective integration.
- **Coverage is computed against the harness's total tool calls**, never against the
  provider's own event count. RFC 0005 reports `Coverage` and `Bypassed`; computed from
  provider events alone, the spike machine would report full coverage while an entire tool
  family bypassed the provider. Overstating savings is the one thing RFC 0005 exists to
  prevent.

## Per-harness findings

Each row names its evidence. Nothing here is declared from documentation, and where a
tier rests on inference rather than a positive control, the row says so.

### Claude Code 2.1.212 — canary

Hooks live in `~/.claude/settings.json` under `hooks.PreToolUse[]` with a `matcher`. The
file is strict JSON with no comment syntax, so the owning action is `merge-json`
appending to `hooks.PreToolUse` — **not** a marker block. RFC 0006 §Golden path shows
`patch marker block ~/.claude/settings.json`, which cannot be written into strict JSON;
that transcript needs amending, and it is the most concrete item in the RFC backlog.

Tier 3 achieved passively: one read-only command through the Bash tool moved the
provider's recorded command count by exactly one, with a PowerShell control that moved
nothing.

### Codex CLI 0.146.0 — config-only, and the configuration is misleading

Hooks live in `~/.codex/hooks.json`, a **separate JSON file** from `config.toml`, so the
owning action is `merge-json` on that file rather than `merge-toml` on the other. Events
supported by this build: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`,
`PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`,
`SubagentStop`, `Stop`.

`codex exec --json` is the active-canary vehicle and the event-stream receipt source.
`codex sandbox` is **not**: it executes commands correctly and traverses no interception
point, so a canary built on it reports a false negative on a working machine.

Tier is `config-only` because no receipt was obtained, for the enablement reason above.
The cause is established from the binary's own strings and from six negative
invocations; it has **not** been confirmed by a positive control, because enabling a hook
writes to the user's configuration and the spike declined to do that unasked.

Project trust is a `config.toml` table keyed by an absolute path quoted as a TOML literal
string — `[projects.'C:\path']` — which is what PLAN §3.2's "trust-aware verification"
attaches to. Codex can also be installed as an MSIX app with a fully populated `~/.codex`
and **no executable on `PATH`**, in which case detection rests on the app-package
inventory, which does supply the version RFC 0002 requires in every receipt.

### OpenCode — tier depends on the provider, not on the harness

The interception point is a **JavaScript plugin**, not a command hook. The installed
`@opencode-ai/plugin` types expose `Hooks` with `event`, `config`, `tool`,
`tool.execute.before`, and `tool.execute.after`.

RFC 0006 §Golden path records `config-only` for OpenCode with the reason "no observable
receipt for a generated plugin wrapper". That reason is correct for an *adopted* provider
whose plugin Token Harness did not write — a plugin cannot be observed from outside. It
is not a property of the harness: `Hooks.event` gives a plugin the whole event stream, so
a Token-Harness-owned canary plugin could record a receipt, and a managed provider with
its own telemetry supplies one anyway. So OpenCode's ceiling is set by the provider's
observability, not by the harness.

Two constraints an adapter must handle:

- **The configuration is not strict JSON.** `~/.config/opencode/opencode.jsonc` on the
  spike machine is rejected by `JSON.parse` — a trailing comma. `merge-json` correctly
  refuses it, so OpenCode needs the comment-and-trailing-comma-preserving editor PLAN
  §17.1 defers. That decision is a prerequisite for Phase 3.4, not a deferrable one.
- **Wiring a plugin installs dependencies.** The config directory carries its own
  `package.json`, lockfile, and `node_modules`, so the action is a package-manager
  install and not only a configuration edit — with the uninstall obligations RFC 0004
  attaches to that.

## The harness adapter contract

PLAN §3.1 lists what a harness adapter implements. These are the clauses this RFC fixes.

An adapter declares, as data in its manifest:

1. the configuration files it reads, and which parser each needs — strict JSON, JSONC,
   TOML, or text with marker fences;
2. the interception points the harness supports, by event name;
3. the **tool families** the harness exposes, per platform, since the set differs on
   Windows;
4. whether interception requires **enablement state** beyond configuration, and where
   that state lives;
5. its receipt family, and the command that produces a machine-readable event stream when
   it has one;
6. its declared verification tier, per version range;
7. tested version ranges, with an unknown-newer warning, symmetric with providers.

An adapter implements:

- `detect`, combining evidence per RFC 0002 §Detection, and never inferring from
  configuration alone;
- `inspect`, reporting configuration *and* enablement, as separate facts;
- `plan`, emitting the action family the file's parser requires;
- `verify`, at the declared tier, defaulting to passive, reporting `not-exercised` when
  nothing has been observed, and comparing the provider's matcher against the tool-family
  list.

An adapter must not: parse agent prose; treat a configuration entry as proof; edit an
active hook without re-checking that it is still active; or report coverage computed from
provider events alone.

## Decisions

- Two receipt families, declared per adapter: proposed.
- Active and passive canaries as distinct mechanisms, with `verify` defaulting to passive
  and active requiring an explicit request: proposed.
- `not-exercised` as a verification result distinct from pass and fail: proposed.
- Tier declared per harness, per version, and per tool family: proposed.
- Coverage computed against harness tool calls rather than provider events: proposed.
- Sentinel constraints — executable, receipt-guaranteeing, attributable,
  side-effect-free: proposed.
- Enablement state as a first-class adapter concern: proposed.

## What this RFC needs from the others

These are open points in accepted documents that RFC 0007 touches. It does not resolve
them unilaterally.

1. **RFC 0006 §Golden path** shows `patch marker block` on `~/.claude/settings.json`.
   Strict JSON has no comment syntax; the family is `merge-json`. The transcript is
   normative and committed, so the Claude adapter cannot be written correctly without
   amending it.
2. **RFC 0002 §Verification** declares the check-status union without `not-exercised`,
   which this RFC needs. It also lacks `info`, which RFC 0006 already uses — the same
   union has now been extended twice by observation.
3. **RFC 0006 §Exit codes** has no code for drift discovered mid-plan; the state layer
   currently reports 5 when nothing was mutated and 6 once something was.
4. **PLAN §17.1** keeps the comment-preserving edit strategy open. OpenCode's `.jsonc`
   makes it a Phase 3.4 prerequisite.
5. **PLAN §3.2** does not anticipate a harness installed with no executable on `PATH`.

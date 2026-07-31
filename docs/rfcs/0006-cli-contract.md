# RFC 0006: CLI contract

- Status: Accepted
- Date: 2026-07-29

## Purpose

The command line is the entire product surface. Exit codes, the machine-readable
envelope, and the stream discipline are public contracts: scripts and CI jobs depend on
them, so they must be defined before Phase 1 implements the CLI shell.

This RFC specifies the contract. It does not specify the content of any individual
report, which belongs to the RFC that owns that domain.

## Streams

| Mode | stdout | stderr |
| --- | --- | --- |
| Human | The report | Diagnostics, progress, warnings |
| `--json` | Exactly one JSON document | Only a failure that prevented serialization |

Rules:

1. `--json` writes one JSON document to stdout and nothing else. No banner, no progress,
   no trailing newline beyond a single terminating one.
2. In human mode, stdout contains only the report. Anything a user would not want in a
   pipe goes to stderr.
3. Diagnostics appear in the JSON envelope, not duplicated on stderr.
4. Colour and any decoration are suppressed when stdout is not a TTY, when `NO_COLOR`
   is set, or when `--json` is used.
5. `--json` implies non-interactive. A command that would prompt fails with the
   confirmation-required exit code instead of prompting.

## Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | `ok` | The command completed and found nothing actionable |
| 1 | `internal-error` | Unexpected failure; a bug in Token Harness |
| 2 | `usage-error` | Unknown command, bad flag, or invalid argument |
| 3 | `problems-found` | A read-only command completed and reported actionable problems |
| 4 | `blocked-by-conflict` | Planning succeeded but a hard conflict prevents apply |
| 5 | `precondition-drift` | The environment no longer matches the plan or journal |
| 6 | `apply-failed-rolled-back` | A mutation failed and the rollback was verified |
| 7 | `apply-failed-dirty` | A mutation failed and rollback did not fully restore state |
| 8 | `confirmation-required` | A mutation needs approval that was not granted |
| 9 | `unsupported-environment` | The runtime, OS, or harness combination is unsupported |

Notes:

- Exit code 3 is reserved for `doctor`, `status`, and `verify`. An empty environment is
  a *state*, not a problem: a first run with nothing installed exits 0. Code 3 means a
  broken integration, an unowned edit on an exclusive surface, a version outside a
  tested range, or a verification result below its declared tier.
- A supported configuration must be able to exit 0. A declared limitation is not a
  problem, and reporting it as one is the fastest way to teach users to ignore the exit
  code. See §Tier-aware verification status.
- Exit code 7 is the only critical code. It always names the exact affected paths and
  the transaction ID on stderr, and it always leaves a failure receipt in the state
  directory.
- Codes are stable within a major version. New conditions get new codes; existing codes
  are never redefined.

## JSON envelope

Every `--json` response is a single object with this shape:

```ts
interface CliEnvelope<T> {
  schemaVersion: 1;
  command: string;              // "doctor", "plan", "metrics", ...
  toolVersion: string;          // Token Harness version
  status: "ok" | "problems" | "blocked" | "error";
  exitCode: number;             // matches the process exit code
  data: T | null;               // command payload; null when status is "error"
  diagnostics: Diagnostic[];    // may be non-empty for any status
}

interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;                 // stable kebab-case identifier
  message: string;              // one sentence, no trailing period-free fragments
  path: string | null;          // absolute path when the diagnostic is file-scoped
  remediation: string | null;   // an action the user can take
}
```

Rules:

1. `schemaVersion` is an integer. A consumer that sees an unknown value must stop rather
   than guess.
2. `status` is derived from `exitCode`: 0 is `ok`, 3 is `problems`, 4 and 5 are
   `blocked`, everything else is `error`.
3. Human output and JSON output are two renderings of the same result object. A field
   visible in human output but absent from `data` is a defect.
4. Diagnostic codes are stable identifiers, not translated strings. Messages may be
   reworded; codes may not.
5. Usage errors (exit 2) also emit a valid envelope when `--json` was parsed
   successfully. An unparseable command line writes plain text to stderr.

## Global flags

| Flag | Applies to | Effect |
| --- | --- | --- |
| `--json` | all | Machine-readable envelope on stdout |
| `--yes` | mutating | Grant approval non-interactively |
| `--plan <id>` | `apply` | Apply a previously computed plan by ID |
| `--harness <id>` | most | Restrict the operation to one harness |
| `--provider <id>` | most | Restrict the operation to one provider |
| `--project <dir>` | most | Operate on that project instead of the current directory |
| `--version` | root | Print the version and exit 0 |
| `--help` | root and subcommands | Print usage and exit 0 |

`--help` and `--version` always exit 0 and always write to stdout, including when the
rest of the command line is invalid.

Mutating commands are dry-run by default. `apply`, `update`, `rollback`, and
`uninstall` compute and display the plan, then require either an interactive
confirmation or `--yes`. There is no flag that skips planning.

## Plan persistence

RFC 0004 requires that a plan record the exact provider versions and actions apply will
use, and that a stale plan be rejected. Both imply that a plan outlives the process that
produced it and can be named. An earlier draft of this document showed
`token-harness apply --plan 7f3a91c2` in a transcript without defining the flag or the
persistence behind it. The mechanism is specified here.

`plan` writes the serialized plan to the state directory under its ID and prints the ID.
The ID is a digest over the plan's normalized content, so identical inputs produce
identical IDs and a changed environment produces a different one.

### Plans are scoped to a project

The state directory is machine-global; a plan is not. A stored plan records the
`projectId` from RFC 0005 and the absolute project root it was computed against, and
`apply --plan <id>` refuses to execute unless both match the current invocation.

Without that binding, an ID computed in one repository could be applied in another. The
digest would still validate, because it covers the plan's content and not the context that
produced it, and the actions would land on project-local paths belonging to a project
nobody reviewed. A mismatch is reported as `plan-project-mismatch` with both roots named.

The binding is a precondition, so it is checked in the same pass as the others below — and
`--project <dir>` does not override it. Retargeting a plan to a different project means
computing a new plan.

`apply` takes one of two forms:

| Form | Behavior |
| --- | --- |
| `apply` | Recompute the plan, display it, require confirmation, then execute |
| `apply --plan <id>` | Load the stored plan, revalidate preconditions, then execute |

`apply --plan <id>` is what makes review-then-execute possible: the artifact a human or a
reviewer approved is the artifact that runs.

Staleness is checked before any action executes. A stored plan is rejected with the
precondition-drift code when:

- the `projectId` or project root differs from the current invocation;
- a recorded precondition digest no longer matches;
- a provider or harness version differs from the one recorded;
- the resolved capability ownership differs from what the plan recorded;
- the plan's schema version is not understood.

Rejection reports which precondition failed. It never partially applies a stale plan, and
it never silently recomputes — a plan whose meaning changed is a new plan, and the user
approves it as one.

### Expiry

RFC 0004 §Backup policy requires retention by count and age but sets no values, so an
earlier draft deferred plan expiry to a policy that did not exist. The defaults are:

| Artifact | Age limit | Count limit | Pinning exempts |
| --- | --- | --- | --- |
| Stored plans | 7 days | 50 most recent | yes |
| Transaction journals | 90 days | 20 most recent | yes |
| Configuration backups | 90 days | tied to their journal | yes |

Plans are the shortest-lived because they are cheap to recompute and their value decays
fast: a week-old plan almost always fails precondition revalidation anyway. Journals and
backups are the safety net, so they are kept far longer and are never evicted while the
journal they belong to survives.

Limits are per project for plans and machine-wide for journals. Both are overridable in
configuration. Eviction runs at the start of any mutating command, so a machine that is
only ever read from never silently loses its history.

An unknown or evicted plan ID is a usage error, distinguished in the diagnostic:
`plan-not-found` when the ID was never stored, `plan-evicted` when it was retained and
then aged out. The second tells the user to recompute; the first suggests a typo.

## Golden path

The following transcripts are normative. Phase 1 commits them as golden files, and any
change to them is a reviewed change to the product surface.

Each transcript is an **independent scenario** with its own fixture tree, named in its
heading. They are not one continuous session, and they must not be read as consistent with
each other — the conflict scenario and the clean-plan scenario deliberately start from
different environments. What must hold is that each transcript is internally consistent
with the RFCs, and reachable from the fixture it declares.

### Scenario: RTK and HarnessTrim installed, neither wired to a harness

```text
$ token-harness doctor
Token Harness 0.1.0 — Windows 11 (x64), Node 22.14.0

Harnesses
  claude      detected    ~/.claude/settings.json
  codex       detected    ~/.codex/config.toml
  opencode    absent

Providers
  rtk           installed     1.4.2   not configured for any harness
  harnesstrim   installed     0.0.5   not configured for any managed harness

Nothing is broken. Run `token-harness plan` to see what would change.
```

Exit code 0. An installed-but-unwired provider is a state, not a problem, so nothing here
contributes to exit 3.

### Scenario: planning against the fixture above

```text
$ token-harness plan --harness claude
Plan 7f3a91c2 — profile safe — harness claude — project <project>

Capability ownership
  shell.command.rewrite      rtk
  shell.output.reduce        rtk

Excluded
  harnesstrim   shell.output.reduce   contested; rtk owns it under profile safe
                                      harnesstrim 0.0.5 reduces Bash only on claude
                                      and exposes no surface selector, so it cannot
                                      be narrowed to a free scope

Actions
  1. merge json           ~/.claude/settings.json     configure rtk hook
  2. write owned file     <state>/receipts/7f3a91c2.json

Network: none. Elevation: none. Backups: 1 file.

Dry run. Nothing was changed. Run `token-harness apply --plan 7f3a91c2`.
```

Exit code 0. An exclusion is a resolved decision, not a problem: the planner had two
candidates for one exclusive scope and picked the profile's owner.

The earlier draft of this transcript assigned `tool.output.reduce` to HarnessTrim on Claude
and described a delegated install that would "narrow to non-shell surfaces". RFC 0003
§Resolution at 0.1.0 establishes that neither is possible with `0.0.5`. Since these
transcripts are committed as golden files, that draft would have frozen an unreachable
state as the expected output.

A second draft of the same transcript showed action 1 as `patch marker block`. It is
`merge json`, and the correction is not cosmetic: RFC 0004 §Ownership lists marker-fenced
blocks and "exact JSON/TOML/YAML entries recorded in its journal" as *separate* ownership
mechanisms, and `~/.claude/settings.json` is strict JSON. A marker fence is a comment, JSON
has no comment syntax, and a fence written into that file would produce a document the
harness can no longer parse — so the earlier draft named an action that cannot be performed
on the file it names.

The Phase 2.5 spike confirmed the live shape: hooks sit at `hooks.PreToolUse[]` with a
`matcher`, so the owning operation is an `append` of one array element identified by the
digest of its value, which is what keeps the user's other hook entries and their order
intact. RFC 0007 §Per-harness findings records it. This is the shape a golden file exists
to freeze, and freezing the wrong one would have made the first correct harness adapter
fail its own transcript.

A third draft carried a `metrics.observe   token-harness` line under Capability ownership. It
is removed, and RFC 0003 §Observational capabilities are outside this model records why: the
ownership address names an interception point, observation has none, and there is nothing to
arbitrate because an observer transforms no payload. The line would have implied that a safety
property came from an ownership assignment when it comes from RFC 0005's deduplication keys.
What Token Harness observes appears in `status` as an importer mode and in `metrics` as a
provider row — both places where it is actually knowable.

### Scenario: brownfield — HarnessTrim already wired to Claude by hand

```text
$ token-harness plan --harness claude
Plan aborted — 1 hard conflict.

  conflict  exclusive-scope-contested
    claude/bash/post-tool-use/shell.output.reduce is claimed by rtk and harnesstrim
    and no compatibility rule covers that pair.
    Fix: choose an owner with `--provider`, or set the surface in token-harness.yaml.

No plan was produced.
```

Exit code 4.

### Scenario: verifying RTK managed on Claude and HarnessTrim adopted on OpenCode

```text
$ token-harness verify
Receipt 7f3a91c2 — applied 2026-07-29T10:12:04Z

rtk — claude — declared tier: canary
  pass  executable-resolves        rtk 1.4.2 at ~/.local/bin/rtk
  pass  hook-registered            PreToolUse entry present and owned
  pass  canary-intercepted         sentinel command was rewritten
harnesstrim — opencode — adopted, not managed — declared tier: config-only
  pass  executable-resolves        harnesstrim 0.0.5
  pass  adapter-config-readable    .opencode/plugin/harnesstrim.ts, mode active
  pass  no-contested-scope         rtk is not configured for opencode
  info  tier-limit                 no observable receipt for a generated plugin wrapper
  info  not-managed                installed by the user; Token Harness will not modify it

Pipeline healthy at the declared tier for every provider.
```

Exit code 0.

`adopted, not managed` is the normal state for HarnessTrim at `0.1.0` per PLAN §6.1: Token
Harness verifies and measures it without having installed it. `no-contested-scope` is the
check that carries the ownership guarantee — it passes here because RTK is not wired to
OpenCode, and it would fail if both held `shell.output.reduce` on the same harness.

Reading the adapter configuration is not incidental. Per RFC 0005, an event's measurement
class depends on whether the adapter is in `active` or `dryrun` mode, so `verify` records
the mode that the importer will rely on.

## Tier-aware verification status

RFC 0002 defines `config-only` as a declared, supported verification tier for harnesses
where a canary is impossible. A check status is therefore relative to what was declared,
not to the strongest tier that exists anywhere.

| Declared tier | Achieved | Status | Contributes to exit 3 |
| --- | --- | --- | --- |
| `canary` | `canary` | `pass` | no |
| `canary` | `config-only` | `fail` | yes |
| `config-only` | `config-only` | `pass` | no |
| `config-only` | `presence` | `fail` | yes |
| any | below declared | `fail` | yes |

The tier limitation itself is reported as `info`, and `info` never contributes to the
exit code. It belongs in the published limitations matrix, which is where a user goes
once, rather than in a warning they see on every run.

An earlier draft emitted `warn` for a correctly functioning `config-only` installation and
exited 3. That would make a fully supported setup permanently red in CI, which does not
make anyone safer: it trains users to add `|| true`, and then a real regression exits 3
into a pipeline that stopped reading exit codes. An exit code that is always non-zero
carries no information.

What still exits 3 is a verification that fell *below* what was promised for that
harness — the case where the plan claimed interception would be proven and it was not.

### Scenario: metrics after a week of RTK on Claude and HarnessTrim adopted on OpenCode

```text
$ token-harness metrics --since 7d
Savings — 2026-07-22 to 2026-07-29 — pipeline b41e

Exact local            1,204,880 -> 331,402 tokens    saved 873,478
Estimated local          412,006 ->  98,220 chars     saved 313,786
Counterfactual                                        none recorded
End-to-end billed                                     no A/B run

By provider (marginal)
  rtk            saved 873,478 tokens   exact-local      4,118 operations   claude
  harnesstrim    saved 313,786 chars    estimated-local  1,440 operations   opencode
                 adopted, not managed — adapter mode active

Coverage 91%. Bypassed 402. Errors 0. Added median latency 11ms.
```

Exit code 0.

Estimated and exact figures are never summed into one headline number, and the two provider
rows are not addable: one is tokens, the other characters.

Two earlier drafts of this transcript each encoded a claim the data cannot support:

1. It credited HarnessTrim with 61,037 tokens of `exact-local` savings. RFC 0005 §HarnessTrim
   establishes that `0.0.5` emits `beforeChars` and `afterChars` only, with token fields left
   `null` and never derived silently, so its events can only be character-based.
2. It then labelled a `mode: "dryrun"` figure as `estimated-local`. Per RFC 0005 §A measured
   reduction is not always a realized one, a `dryrun` event describes bytes that stayed in
   context, so it is `counterfactual` and belongs on the counterfactual line — not in a
   provider's realized savings, whatever the annotation next to it says.

This transcript's fixture has the adapter in `mode: "active"`, so the reduction was applied
and `estimated-local` is correct. A `dryrun` fixture is a separate golden file, and in it the
`Counterfactual` line carries the figure and the provider row shows no realized saving.

Both drafts are recorded because they are the same mistake in two costumes: attaching a
stronger measurement class to a number than the source can justify. Golden files are where
that becomes permanent.

## Golden-file determinism

Golden comparisons normalize, in this order:

1. the Token Harness version;
2. absolute paths, replaced by `<home>`, `<state>`, and `<project>` tokens;
3. timestamps and durations;
4. plan, pipeline, and transaction IDs, replaced by stable ordinals;
5. line endings.

Everything else is compared byte-for-byte. Provider and harness versions are *not*
normalized: they come from fixtures and are part of the expected output.

## RFC number allocation

To keep numbering coherent, the next identifiers are reserved now:

| RFC | Subject | Status |
| --- | --- | --- |
| 0006 | CLI contract | Accepted (this document) |
| 0007 | Live verification mechanism | Proposed — written from the Phase 2.5 spike |
| 0008 | Metrics storage driver | Reserved — written only when JSONL storage is outgrown |

## Decisions

- Exit-code table: accepted and stable within a major version.
- Single-document JSON envelope with `schemaVersion`: accepted.
- Human and JSON output as renderings of one result object: accepted.
- Dry-run default with no plan-skipping flag: accepted.
- Persisted plans addressable by `--plan <id>`, revalidated before execution: accepted.
- Verification status relative to the declared tier, so a supported configuration exits
  0: accepted.
- Golden files for human output, not only JSON: accepted.

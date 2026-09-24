# RFC 0028 — Context Governor snapshot contract

Status: Accepted for the initial CLI integration
Date: 2026-09-24
Owners: Token Harness
Target: PLAN §19.2

## Purpose

`token-harness optimize` cannot infer which part of an active conversation is obsolete from context
pressure, instruction sizes, or local session history. This RFC defines an optional, read-only input
for a runtime integration that has direct evidence about the current task and its context materials.
The portable Token Harness Agent Skill may produce this metadata from its active conversation and
its own tool results; it must not ask the user to author the JSON.

The snapshot contains bounded metadata only. It never contains transcript text, prompts, tool
payloads, source text, paths, MCP names, or schemas. Without a snapshot, existing `optimize`
behavior is unchanged.

## Invocation and schema

Use:

```text
token-harness optimize --context-snapshot <path>
```

A relative path is resolved from the CLI working directory.

The UTF-8 JSON file has a 64 KiB maximum and at most 128 material observations. Schema version 1
contains:

- `schemaVersion: 1`;
- `harnessId`: `claude` or `codex`;
- `taskBoundary`: `continuing`, `completed`, `new-task`, or `unknown`;
- `validation`: `passing`, `failing`, `unresolved`, or `unknown`;
- `quality`: `passed`, `regressed`, or `unknown`;
- optional `retryRegression` and `checkpointRequired` booleans;
- `reuse`: `efficient`, `inefficient`, or `unknown`;
- optional `checkpointMaxBytes`, at least 256 when non-null;
- `materials`: bounded records of `kind`, `state`, measured `byteLength` (a non-negative safe
  integer or `null`), and `reduction` attribution.

Unknown fields are rejected so a producer cannot accidentally place content in an ignored property.
Context pressure is taken from the existing Token Harness observation; the snapshot cannot supply or
override it.

## Decision and output

The CLI reads the file through its injected filesystem port and validates the whole schema before
using it. An unreadable, oversized, malformed, or mismatched snapshot returns a usage error. No
mutation occurs.

The result is attached to the matching harness in `OptimizeReport`, rendered in both machine and
human modes, and its evidence remains separate from allowance measurements. `byteLength` and
`actionableBytes` are local byte counts only; they are not tokens, subscription percentages, or
predictions of quota savings.

Policy constraints:

- only explicitly superseded tool output or repository reads can be recommended for deterministic
  masking;
- summarization requires explicit `condensable` state and no prior RTK, HarnessTrim, other, or
  unknown reduction attribution;
- failing or unresolved validation, quality regression, or retry regression vetoes aggressive
  material reduction;
- leaving a task with unresolved state requires a bounded checkpoint; a completed task can advise a
  fresh session only after validation passes and no unresolved state remains;
- checkpoint and compaction advice requires a valid artifact byte ceiling. Artifact construction
  continues through the existing `buildCompactHandoff` contract.

## Privacy and evidence boundary

Snapshot producers are responsible for reporting only facts they directly observed. Token Harness
does not read the active transcript or reconstruct current task state from local history. Missing
evidence stays unknown. Context reduction is never converted into claimed subscription savings.
Producers create the file temporarily and remove it after the CLI call. They must omit unavailable or
unmeasured observations rather than infer state from task names, local token totals or incomplete
history.

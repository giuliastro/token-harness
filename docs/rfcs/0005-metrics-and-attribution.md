# RFC 0005: Metrics and attribution

- Status: Accepted
- Date: 2026-07-29

## Goal

Token Harness reports how much context or model output was avoided without presenting
incompatible measurements as one precise number.

## Measurement classes

### Exact local

Both the original and transformed payload are observed in the same operation.

Examples:

- RTK command output before and after filtering;
- HarnessTrim reducer input and output;
- a lazy MCP proxy's known schema bytes before and after activation.

### Estimated local

The payload is observed, but tokens are derived from a tokenizer or character
heuristic that may differ from the model provider.

### Counterfactual

The optimized path is observed, but the baseline is inferred from a control group or
model.

Example: estimated visible output that Caveman prevented.

### End-to-end billed

The harness or model provider reports usage for comparable baseline and optimized
sessions. This is the strongest session-level evidence, but it requires an A/B design
and task-quality checks.

These classes are never merged into an unlabeled exact total.

## Normalized event

```ts
interface OptimizationEvent {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;

  provider: {
    id: string;
    version: string | null;
  };

  context: {
    projectId: string;
    harnessId: string;
    sessionId: string | null;
    operationId: string;
    pipelineId: string | null;
    pipelineOrder: number | null;
    toolFamily: string | null;
    capability: string;
  };

  measurement: {
    class: "exact-local" | "estimated-local" | "counterfactual" | "end-to-end-billed";
    beforeChars: number | null;
    afterChars: number | null;
    beforeTokens: number | null;
    afterTokens: number | null;
    tokenizer: string | null;
    confidenceLow: number | null;
    confidenceHigh: number | null;
  };

  outcome: {
    changed: boolean;
    bypassReason: string | null;
    originalReference: string | null;
    latencyMs: number | null;
    errorCode: string | null;
  };

  source: {
    nativeEventId: string | null;
    importedAt: string;
  };
}
```

Raw command text, raw tool output, source code, file paths, prompts, and credentials are
not part of the normalized event.

## Identity and privacy

- `projectId` is a local stable hash with a machine-local salt.
- Command and path values are represented only by coarse tool family where possible.
- Session IDs are local identifiers and are never exported by default.
- Original references point to provider-local storage; Token Harness does not copy raw
  output into its metrics database.
- Import cursors and native event IDs prevent duplicate ingestion.

## Pipeline attribution

For a validated provider chain:

```text
raw payload:       1,000 tokens
after provider A:    300 tokens
after provider B:    200 tokens
```

Attribution is:

- provider A marginal saving: 700;
- provider B marginal saving: 100;
- pipeline saving: 800.

It is not:

- provider A's 700 plus provider B claiming 800 against the raw payload.

Events in a chain share `operationId` and `pipelineId`, and use monotonically increasing
`pipelineOrder`. The aggregator calculates raw-to-final totals once.

If the chain cannot expose stage boundaries, Token Harness reports only pipeline-level
savings and marks per-provider attribution unavailable.

## Storage

The domain layer depends on a storage interface. No provider, planner, or report knows
which backend is in use.

```ts
interface MetricsStore {
  appendEvents(events: OptimizationEvent[]): Promise<void>;
  readCursor(providerId: string, sourceId: string): Promise<ImportCursor | null>;
  writeCursor(cursor: ImportCursor): Promise<void>;
  query(filter: EventFilter): AsyncIterable<OptimizationEvent>;
  upsertReceipt(receipt: VerificationReceipt): Promise<void>;
}
```

The store holds:

- provider inventory;
- metric import cursors;
- normalized events;
- daily aggregates;
- benchmark runs;
- verification receipts.

### 0.1.0 backend

`0.1.0` implements `JsonlStore`: append-only JSONL files under the platform state
directory, with aggregation in memory at query time.

Rationale, per RFC 0001: append-only JSONL fits the workload exactly. Ingestion is
append, reporting is a full scan over a bounded window, and there are no updates except
cursors, which live in a separate small file. At single-developer volume the difference
against an indexed store is unmeasurable.

`node:sqlite` is available without a flag from Node 22.13.0, so the flag is not an
argument against it. What remains is that on the minimum supported runtime it is
Stability 1.1, "Active development", and that importing it emits `ExperimentalWarning` on
stderr, which conflicts with the stream discipline in RFC 0006. `better-sqlite3` needs
per-platform prebuilt native binaries that fight a self-contained ESM bundle.

None of that is disqualifying. It is the reason to wait for a need rather than to pick
now.

### When a driver is chosen

A driver is selected, and RFC 0008 written, when one of these is observed:

- a report whose window makes a full scan exceed roughly one second on typical hardware;
- a need for concurrent writers, which JSONL append tolerates only coarsely;
- benchmark result sets that require joins rather than grouping;
- `node:sqlite` reaching Stability 2 on the minimum supported runtime, at which point the
  remaining objections expire and the comparison is worth running on its merits.

The last trigger is a date, not a defect, which makes it the likeliest one. Until then
the decision stays open and costs nothing. Migration from JSONL is a one-time import, and
the storage interface is the seam that makes it so.

The `MetricsStore` interface is therefore not decoration. It is what keeps this a
deferred decision rather than an assumption baked into every importer and report.

## Importers

### RTK

Source: RTK's own command history database, `<user data directory>/rtk/history.db`, table
`commands`. One row per intercepted command, with a monotonic `INTEGER PRIMARY KEY`.

This section originally named `rtk gain --all --format json` as the metrics source. That was
wrong, and the correction is recorded here rather than only in the adapter, because the
reason generalises: **an aggregate is not a stream of events, and no cursor can make it
one.**

What was observed against RTK 0.42.0:

- the finest machine-readable grain the CLI offers is a *daily aggregate*. `--history`
  silently ignores `--format json`, returning only `summary`, and returns zero bytes for
  `--format csv`; in text mode it aggregates by command family. There is no per-operation
  output in any format;
- the aggregate mutates in place. Two invocations one minute apart reported
  `daily[2026-07-31] = 11 commands / 165 saved` and then `13 / 170`. The dedup model in
  §Deduplicating a stream without event IDs assumes an append-only file in which a past line
  never changes. Against a mutable aggregate, discarding what is already held freezes the day
  at its first observed value and understates savings permanently; not discarding
  double-counts;
- `ImportCursor`'s members are all shaped for a file, and a CLI invocation has no path, no
  byte offset, and no last line.

The database resolves all three: rows are immutable, the identifier is native so dedup needs
no synthesis, and the cursor is a high-water mark.

It also carries a figure the aggregate cannot express. On the machine this was written
against, **2,149 of 2,847 intercepted commands — 75.5% — saved zero tokens**: RTK proxied the
command and passed the output through unchanged. The aggregate reports 9.5% average savings
and cannot say that three quarters of interceptions moved nothing. `outcome.changed` exists
so coverage and bypass metrics stay correct, and only the per-operation source can set it.

Mapping to the normalized event:

| Normalized field | Source |
| --- | --- |
| `measurement.class` | `exact-local` — §Exact local names this case: "RTK command output before and after filtering" |
| `measurement.beforeTokens` / `afterTokens` | `input_tokens` / `output_tokens` |
| `measurement.beforeChars` / `afterChars` | `null` — never derived from the token counts |
| `measurement.tokenizer` | `rtk`, recorded so a reader can judge a figure counted by RTK's tokenizer rather than the model provider's |
| `context.projectId` | `project_path`, normalized and salted per §Privacy |
| `context.harnessId` | `unknown` — a row carries no harness, and reading one off today's configuration would attribute months of history to today's wiring |
| `context.capability` | `shell.output.reduce`: the command ran either way, and what shrank was its output |
| `outcome.changed` | `output_tokens < input_tokens` |
| `outcome.latencyMs` | `exec_time_ms` |
| `source.nativeEventId` | `id` — native, not synthesized |

`original_cmd` and `rtk_cmd` hold raw command text and are **never selected**. §Privacy
forbids retaining it, and a `SELECT *` would satisfy every other property of this importer
while leaking both columns.

Cross-check on the machine above: the sum of `saved_tokens` over the imported rows is 91,600
over 2,847 events, which is exactly what `rtk gain` reports as `total_saved` for
`total_commands`. The per-operation import and the tool's own aggregate agree.

#### The cursor for a source with native identifiers

`ImportCursor` gains `highWaterMark`. For a source whose records carry their own monotonic
identifier it is authoritative, and `byteOffset` and `lastLineDigest` are not used — filling
them with placeholders would make the cursor a record of nothing.

`fileIdentity` carries the *generation* instead of a device or inode: for RTK it is the lowest
surviving `id` and the row count. §Deduplicating a stream without event IDs wanted the digest
to confirm "the file was appended to rather than rewritten"; `rtk gain --reset` empties the
table, and a repopulated one starts again from a low `id`. When the generation changes the
import restarts from zero, which is safe because the event identity is the native row id.

Without that check a stored mark higher than the new table's maximum would suppress every row
forever, and the importer would report a healthy no-op on each run.

#### Fidelity modes

| Mode | Condition | Consequence |
| --- | --- | --- |
| `native` | the history database is readable | per-operation `exact-local` events, native dedup |
| `unavailable` | no reader, no database, or no SQLite driver | no events, and `status` says so |

There is no `legacy` mode for this provider. The only other source is the daily aggregate, and
there is no honest event to make from it. Reporting nothing is correct; inventing per-operation
figures from a sum is the failure the measurement classes exist to prevent.

The CLI analytics keep the job they already had: the dated passive receipt of RFC 0007
§Active and passive canaries. They are not turned into events.

#### Reading the database without breaking stream discipline

RFC 0001 §Storage and §0.1.0 backend both reject `node:sqlite`, and the objection stands:
importing it emits `ExperimentalWarning` on stderr, and RFC 0006 permits nothing on stderr in
`--json` mode. The recorded reasoning was that silencing it "means either `--no-warnings`
process-wide or mutating the process warning listeners — both worse than not needing it".

There is a third mechanism, and it is the one used here: read the database in a short-lived
child process, re-entering the same artifact with an internal argv marker, with
`--no-warnings` scoped to that child alone. The parent's streams are untouched. The driver
must load in the child and nowhere else, which is enforced as an architecture rule rather than
left to intent, and the child's import is dynamic so a bundler cannot hoist it into the
parent.

This does **not** reopen `node:sqlite` as the storage backend for Token Harness's own metrics.
That would be an in-process import in the CLI itself, where the warning lands on the user's
stderr and there is no child boundary to contain it. §When a driver is chosen is unchanged.

### HarnessTrim

Source: its JSONL telemetry files. As of HarnessTrim `0.0.5` the on-disk record is:

```ts
interface TrimEvent {
  ts: string;              // ISO timestamp stamped by the emitter
  harness: string;         // "opencode", "codex", "claude", "hermes", "pi"
  tool: string;            // "bash", "read", ...
  reducer: string | null;  // null when no reducer matched
  beforeChars: number;
  afterChars: number;
}
```

Default locations are `.harnesstrim/metrics.jsonl` in the project and
`~/.hermes/harnesstrim-metrics.jsonl` for the Hermes adapter. Telemetry is off by default
upstream and is enabled by the `--metrics` flag on the reducing command.

The importer works against exactly this shape. No upstream change is required.

Mapping to the normalized event:

| Normalized field | Source |
| --- | --- |
| `measurement.class` | `estimated-local` when the reduction was applied; `counterfactual` when it was not — see below |
| `measurement.beforeChars` / `afterChars` | direct |
| `measurement.beforeTokens` / `afterTokens` | `null` — never derived silently |
| `context.harnessId` | `harness` |
| `context.toolFamily` | `tool` |
| `context.capability` | resolved from the pipeline for that harness and tool |
| `outcome.changed` | whether the payload the model saw was actually modified |
| `source.nativeEventId` | `null` upstream; synthesized as described below |

### A measured reduction is not always a realized one

`TrimEvent` records what the reducer computed, not whether the result reached the model.
HarnessTrim's OpenCode adapter emits an event in `mode: "dryrun"` as well as in
`mode: "active"`: it measures `beforeChars` and `afterChars` identically, and in `dryrun`
leaves `output.output` untouched.

Two events with identical numbers can therefore mean opposite things, and the importer must
not collapse them:

| Upstream mode | Payload modified | `measurement.class` | `outcome.changed` |
| --- | --- | --- | --- |
| `active` | yes | `estimated-local` | `true` |
| `dryrun` | no | `counterfactual` | `false` |

`estimated-local` asserts that a real transformation happened and only the token count is
approximate. A `dryrun` event asserts nothing of the kind: the bytes stayed in context, and
the figure describes a saving that did *not* occur. Filing it as `estimated-local` would
inflate reported savings with output the model actually received — the precise failure the
measurement classes exist to prevent.

Counterfactual is the correct class, with one qualification worth recording: this
counterfactual comes from a deterministic reducer replayed on observed input, not from a
model-inferred baseline, so its confidence interval is narrow. It is still not a saving.

Reports show `dryrun` figures on the counterfactual line only, never in realized totals and
never added to the pipeline saving. Because `outcome.changed` is `false`, a coverage or
bypass metric derived from it also stays correct without special-casing.

Determining the mode is part of detection: the importer reads the effective adapter
configuration for that harness and records it in the import receipt, so an event's class is
reproducible rather than guessed.

### Deduplicating a stream without event IDs

`TrimEvent` has no native identifier, and `ts` is not unique under concurrency, so
identity must be reconstructed. The importer uses the file as the ordering authority:

- the cursor is `(absolute path, device/inode or volume identity, byte offset, digest of
  the last imported line)`;
- ingestion resumes at the stored byte offset;
- the digest confirms the file was appended to rather than rewritten or rotated;
- a digest mismatch means the file was truncated or replaced, so the importer restarts
  from offset zero and relies on the synthesized identity to discard what it already has;
- the synthesized identity is a hash of the source identity, the line ordinal, and the
  line content.

This makes repeated imports idempotent without upstream cooperation. When HarnessTrim
later adds `schemaVersion` and a native event ID, the importer prefers them and the
synthesized path becomes the fallback for older files.

### Importer degradation policy

An importer states which fidelity mode it is running in, and the mode appears in
`status` output. For HarnessTrim:

| Mode | Condition | Consequence |
| --- | --- | --- |
| `native` | Upstream exposes `metrics --json` with IDs and tokens | Exact or declared-estimate classes, native dedup |
| `legacy` | Character-only `TrimEvent` JSONL | `estimated-local` only, synthesized dedup |

Running in `legacy` mode is a supported steady state, not a warning. What would be a
defect is presenting legacy character estimates as exact token savings, which the
measurement class prevents by construction.

### Other providers

Each provider documents its source and confidence. A provider without measurable
output appears in status as "active, savings unavailable" rather than fabricating a
number.

## Reports

```text
token-harness metrics
token-harness metrics --provider rtk
token-harness metrics --harness codex
token-harness metrics --project
token-harness metrics --since 7d
token-harness metrics --json
```

Human reports show:

- exact local savings;
- estimated savings;
- counterfactual savings and confidence range;
- end-to-end A/B results;
- provider and capability breakdown;
- coverage and bypass counts;
- added latency;
- errors and full-output retrieval rate.

## Benchmark standard

### Release gating

The full A/B benchmark below requires a control design, task-quality scoring, and access
to billed-token reporting. It is closer to a measurement study than to a test suite, and
gating `0.1.0` on it would block the release on the hardest thing in the project.

The gates are therefore split:

| Gate | `0.1.0` | `1.0.0` |
| --- | --- | --- |
| Deterministic must-keep recall on committed fixtures | required, 100% | required |
| No exact-savings claim without both payloads observed | required | required |
| Rollback restores fixtures byte-for-byte | required | required |
| Measurement class labelled on every reported figure | required | required |
| Provider overhead attributable to the provider | required | required |
| Full A/B matrix with task-success scoring | not required | required |
| Published raw benchmark results | not required | required |

`0.1.0` must therefore prove that Token Harness does not lie about savings and does not
damage configuration. It does not have to prove how large the savings are — the A/B
matrix is what establishes that, and it lands with `0.2.0` and `1.0.0`.

### Benchmark scenarios

Benchmark scenarios:

- quiet: little reducible output;
- noisy: large single tool result;
- repetitive: repeated tests, typechecks, search, and diff;
- MCP-heavy: large schemas and external results;
- large-repository: exploration and targeted retrieval;
- mixed: realistic multi-tool coding task.

Every A/B run records:

- task success;
- must-keep signal recall;
- total billed input/output/reasoning tokens when available;
- cache reads/writes when available;
- wall-clock time;
- provider overhead;
- number of tool calls;
- user-visible output quality.

A saving is not accepted if task success regresses beyond the benchmark's declared
tolerance.


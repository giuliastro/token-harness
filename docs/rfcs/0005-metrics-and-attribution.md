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

Normalized events and installation receipts use a local SQLite database in the
platform state directory.

The database stores:

- provider inventory;
- metric import cursors;
- normalized events;
- daily aggregates;
- benchmark runs;
- verification receipts.

The selected Node SQLite driver is a Phase 1 implementation spike. The domain layer
depends on a storage interface so the choice does not leak into providers.

## Importers

### RTK

Preferred source: machine-readable analytics export such as:

```text
rtk gain --all --format json
```

The adapter validates upstream schema versions and maps command families without
retaining command arguments.

### HarnessTrim

Initial source: its JSONL `TrimEvent` files.

Before the Token Harness MVP, HarnessTrim should add:

- schema version;
- native event ID;
- token counts or declared estimation method;
- harness/session/operation identifiers where available;
- machine-readable metrics output.

Legacy character-only events remain importable as `estimated-local`.

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


# Observe JSON contract v1

The intended Harness Remote polling command is:

```sh
token-harness observe --json --since 7d
```

One invocation returns the standard CLI envelope (`schemaVersion: 1`, `command: "observe"`, `toolVersion`, `status`, `exitCode`, `data`, and `diagnostics`). The payload has a **separate version**, `data.contractVersion: 1`. Validate both versions, and reject unsupported versions instead of guessing. [JSON Schema](observe-v1.schema.json).

## v1 fields

- `contractVersion`: integer `1`. Breaking changes require v2.
- `observedAt`: ISO-8601 UTC instant for this CLI request.
- `readOnly`: always `true`.
- `metricsFreshness`: always `"stored-only"`, not a live provider import.
- `agents[]`: `harnessId`, `name`, `state` (`absent`, `detected`, `configured`, `broken`, or `error`), and `version` (string or null). Detection does **not** mean an active agent session.
- `quotas`: existing `BudgetReport` with native harness windows, use %, reset times, origin and confidence. `unavailable` or `absent` is not 0%.
- `metrics`: existing `MetricsReport` aggregated only from imported local evidence. The scope is **all stored projects** and includes unattributed records; do not display it as the current project's usage.

Example of the envelope (abbreviated; `metrics` here is not a full schema-valid report):

```json
{
  "schemaVersion": 1,
  "command": "observe",
  "toolVersion": "0.1.31",
  "status": "ok",
  "exitCode": 0,
  "data": {
    "contractVersion": 1,
    "observedAt": "2026-10-17T12:00:00.000Z",
    "readOnly": true,
    "metricsFreshness": "stored-only",
    "quotas": {"platform": {}, "observedAt": "2026-10-17T12:00:00.000Z", "harnesses": []},
    "agents": [{"harnessId": "codex", "name": "Codex", "state": "detected", "version": null}],
    "metrics": {"scope": "all-projects", "windowStart": "2026-10-10", "windowEnd": "2026-10-17"}
  },
  "diagnostics": []
}
```

## Read-only guarantees and semantics

`observe` performs no Token Harness evidence writes: no provider metrics imports, event appends, import cursor changes, receipts, state-root initialization or attribution-salt creation/replacement. It may perform bounded **native read-only quota probes**. It does not install software, invoke models or change an agent configuration.

`token-harness metrics --read-only --json` uses the same non-importing metrics read path; regular `metrics` preserves its existing importer behavior. With no valid pre-existing salt, read-only metrics reports all stored projects instead of synthesizing an identity.

Never add estimated and exact savings, or infer native quotas from token reduction. Empty evidence is not proof of zero optimization. `null` means unknown, not zero. Distinguish the quota observation time from the local event timestamps (`firstRecordedAt` and `lastRecordedAt` where available).

The CLI can return `data: null` on failure; inspect `status`, `exitCode` and `diagnostics`. A v1 addition may be optional, but removal or changed types/semantics require v2. Poll conservatively: one CLI invocation can perform multiple native observations.

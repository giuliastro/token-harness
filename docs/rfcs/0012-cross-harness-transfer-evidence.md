# RFC 0012 — Cross-harness transfer evidence receipts

- Status: Accepted
- Date: 2026-09-04
- Owners: Token Harness
- Depends on: RFC 0011

## Summary

RFC 0011 requires a Claude Code ↔ Codex switch to have comparable empirical evidence that the
expected transfer benefit exceeds its handoff cost. This RFC defines the persistent evidence seam
for that decision.

A transfer assessment is first produced from an explicit paired experiment:

- baseline = stay on the current harness;
- optimized = switch to a different candidate harness;
- same benchmark id and task class;
- explicit quality outcomes;
- the exact compact handoff used by the switched run.

`token-harness transfer-record` then freezes that assessment into an immutable local receipt.

## Receipt

The receipt is stored beside the paired benchmark state as:

`<state>/benchmarks/<benchmark-id>/transfer.json`

Schema 1 records only:

- benchmark id;
- machine-local project id, never the raw project path;
- task class;
- current and candidate harness ids;
- actual handoff byte length;
- SHA-256 of the exact handoff bytes;
- configured handoff byte budget;
- conservative `proven-positive | non-positive | unknown` benefit;
- the comparator basis and reasons;
- recording timestamp.

The receipt does not copy conversation text, prompt text, handoff content, credentials, provider
quota percentages, or local token counts.

## Immutability

A transfer receipt is write-once. If `transfer.json` already exists, Token Harness returns
precondition drift and does not overwrite it. A rerun therefore requires a new benchmark id.

The SHA-256 digest makes the exact measured handoff externally verifiable without persisting its
content. The byte length preserves the transfer-cost observation used by the comparator.

## Evidence semantics

The receipt stores the comparator's verdict; it does not recompute a new score.

In particular:

- Claude and Codex backend quota percentages remain separate budget domains;
- local token counts are never converted into subscription quota;
- quality regression or an over-budget handoff can make a transfer non-positive;
- quality, failed attempts, normalized runtime/provider errors, and total attempts are the initial
  cross-harness comparable units;
- ties or missing comparable evidence remain `unknown`.

## Scheduler consumption

`schedule` consumes only valid transfer receipts attributed to the current local project. A receipt
must also match the exact current harness, candidate harness, and task class before it can contribute
to the verdict. A receipt stored under a directory whose benchmark id does not match the receipt is
ignored.

Multiple matching receipts are aggregated conservatively:

- every attributable receipt `proven-positive` → hydrate `proven-positive`;
- every attributable receipt `non-positive` → hydrate `non-positive`;
- any positive/non-positive conflict → remain `unknown`;
- any set containing an `unknown` receipt → remain `unknown`;
- no matching receipt → remain `unknown`.

An explicit `--transfer-benefit`, including explicit `unknown`, always wins and suppresses automatic
transfer-receipt hydration.

Historical handoff byte observations remain part of the immutable receipt, but scheduler hydration
does not substitute them for the current handoff estimate. `--handoff-bytes` and
`--max-handoff-bytes` continue to describe the current scheduling decision.

This RFC does not authorize automatic harness switching. The scheduler remains advisory unless a
separate opt-in execution contract is approved.

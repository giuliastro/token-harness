# RFC 0025 — Context savings benchmark contract

Status: draft

## Purpose

Savings Engine needs to compare context/tool-deferral mechanisms without turning local context measurements into false subscription-quota claims.

This RFC defines the evidence boundary used before Token Harness admits a broad context owner such as Headroom or Context Mode.

## Evidence classes remain separate

A paired benchmark may now carry additive context snapshots alongside the existing quality, retry, local-token and backend-quota evidence.

Context evidence records only bounded facts:

- raw MCP server count;
- raw known MCP tool count;
- number of servers whose tool count is unknown;
- effective static MCP server/tool exposure after only runtime-proven deferral;
- observed deferral state and mechanism.

No tool names, schemas, prompts or tool payloads are persisted by this witness.

A smaller context surface is not converted into Claude/Codex subscription percentage. Subscription efficiency remains decided only by comparable authoritative/reported same-window quota evidence.

## Comparison rule

For context exposure itself:

1. effective static MCP tool exposure is the primary comparison;
2. effective static MCP server exposure is secondary;
3. raw known MCP tool inventory is a final context-shape tiebreaker;
4. missing or partial-incompatible evidence fails closed to `unknown`;
5. context reduction never overrides a failed quality gate.

The existing benchmark verdict remains quality/quota first. Context comparison is an additional witness, not a replacement score.

## Candidate admission

A broad context owner may be recommended only after repeated paired tasks demonstrate all applicable gates:

- explicit quality pass on baseline and candidate;
- no material retry/runtime-error regression;
- measurable attributable context reduction;
- no overlapping broad context owner enabled by default;
- reversible or explicitly bounded ownership;
- no implicit paid API path;
- cross-platform/version support matching the claimed surface.

If authoritative backend quota evidence is also available, Token Harness may additionally determine quality-adjusted subscription efficiency. Without it, the result remains a local/context optimization claim only.

## Headroom and Context Mode

The initial candidate review treats Headroom and Context Mode as experiments, not preselected winners. At most one may become the default broad context owner.

A candidate that merely delays process startup without reducing model-visible tool/schema context does not qualify as a context saver.

A candidate that reduces local context but materially increases retries or failed quality gates loses the comparison.

## Compatibility

Context witnesses are additive to benchmark schema 1. Existing captures and receipts without `contextAtStart`/`contextAtFinish` remain valid and parse without fabricated evidence.

## Next step

Expose the context comparison in benchmark/matrix reports, then run controlled baseline-vs-candidate fixtures. Only after those results should Token Harness add installation/lifecycle support for a winning broad context owner.

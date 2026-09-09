# Optimizer integration priorities

Token Harness prioritizes **useful work preserved per Claude Code/Codex allowance**, not the largest raw token percentage in isolation. A candidate moves up when it can remove a large recurring cost, applies to real user workloads, has a reversible integration path, and can be measured without weakening quality.

## Current order

| Priority | Tool / policy | Savings target | Status | Admission rule |
| --- | --- | --- | --- | --- |
| P0 | Native reasoning / verbosity policy | Avoid overspending reasoning on simple work while protecting hard tasks | Supported | Quality floors + reviewed native writes |
| P0 | RTK | Shell/tool output noise | Supported | Reviewed compatibility + attributable telemetry |
| P0 | HarnessTrim | Deterministic output/context reduction | Supported | Reviewed compatibility + attributable telemetry |
| P0 evidence | cclimits / native allowance readers | Make 5h/7d impact measurable | Read-only | Never treated as an optimizer |
| P0 evidence | ccusage / local history | Local workload evidence | Read-only | Never promoted to subscription quota |
| **P1** | **mcptoon discovery/schema decoupling** | **Static MCP tool-schema context tax** | **Next integration candidate** | Detect read-only, measure native-vs-index context, then paired quality benchmark before recommendation; no silent `sync` |
| P2 | Headroom | Broad context ownership / compression | Benchmark-ready candidate detection | RFC 0026 context-owner admission; no silent wrap |
| P2 | mcptoon result encoding (`--toon` / per-tool policy) | MCP call-result payload | Later experiment | Must beat RTK/HarnessTrim/Headroom on marginal savings without quality/retry regression; one owner per phase |
| P3 | API billed-token cost attribution | API money saved | Evidence gap | Requires billed input/output tokens plus verified model pricing; local-token estimates are insufficient |

## Why mcptoon is P1

For MCP-heavy agents, static tool schemas can consume a large context budget before the task starts. mcptoon attacks that cost at the discovery layer, which is different from RTK/HarnessTrim output reduction and therefore has unusually high potential **marginal** savings.

Token Harness will not copy mcptoon's upstream benchmark numbers into the user's savings total. The planned integration is evidence-first:

1. detect the installed CLI and version without changing configuration;
2. inspect the current MCP/tool surface;
3. estimate or measure the current schema/context tax from local observations;
4. benchmark the native tool surface against mcptoon's compact discovery path;
5. run paired task evidence for tool selection, retries, runtime errors and explicit quality gates;
6. recommend activation only after the evidence is quality-safe;
7. preview any configuration mutation and require explicit approval, with rollback.

`mcptoon sync`, agent configuration writes, and result compression are **not** part of detection. Result-side TOON compression is a separate capability because it can overlap with existing reducers.

## Capability ownership rule

Token Harness should avoid compression stacks that make savings and quality impossible to attribute. The intended ownership split is:

- MCP tool discovery/schema: mcptoon candidate;
- shell/tool result reduction: RTK / HarnessTrim / mcptoon-result / broad context owner compete on measured marginal value;
- broad context ownership: Headroom-class candidates;
- model/reasoning policy: Token Harness native policy;
- allowance and billing evidence: read-only observers.

Only one optimizer should own an overlapping phase unless a paired benchmark proves the composition adds quality-safe marginal value.

## Stable-release gate

Do not call a release ready for broad promotion merely because features exist. A promotion-ready stable release should have:

- the outcome-first Dashboard / Policies / Evidence UX;
- no periodic full dashboard reload and no full reload after every setting change;
- clear current-policy state, next action and rollback path;
- recorded reducer savings kept separate by measurement class;
- paired allowance/quality evidence surfaced when available, with missing data shown as missing;
- no invented 5h/7d, API-money or quality claims;
- setup/apply/verify/undo flows green on Windows, macOS and Linux;
- package/install smoke tests green from the published artifact;
- README onboarding aligned with the actual UI and current supported integrations.

A new experimental optimizer is **not** required for that stable-release gate. mcptoon and Headroom can remain admission-gated candidates while the core product is promoted.

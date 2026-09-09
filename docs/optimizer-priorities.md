# Optimizer evaluation priorities

Token Harness prioritizes **useful work preserved per Claude Code/Codex allowance**, not the largest raw token percentage in isolation. No external project becomes the next integration merely because it was suggested, popular, or publishes an impressive benchmark.

The question is always: **what additional quality-safe value does this mechanism add on top of the current native harness and the optimizers Token Harness already owns?**

## Selection rule

Every candidate is scored on the same dimensions before it is promoted:

1. **Marginal savings** — value added after current Claude/Codex native behavior, RTK and HarnessTrim, not versus an artificially unoptimized baseline.
2. **Coverage** — how often the mechanism can help normal Claude Code and Codex workloads.
3. **Allowance / API relevance** — preference for effects that can be tied to provider allowance or billed-token evidence, not only local byte/token estimates.
4. **Quality safety** — paired task quality, retries, failures and exact-answer/source-verification checks override raw savings.
5. **Distinctness** — overlapping compressors are penalized unless composition proves additional value.
6. **Reversibility** — preview, explicit approval, verification and rollback must be possible before managed activation.
7. **Operational cost** — latency, memory, indexing/startup cost and background work count against the saving.
8. **Maturity and maintenance** — release activity, compatibility surface, license, failure history and integration maintenance all matter.
9. **Attribution** — Token Harness must be able to say which mechanism produced the observed result.

Upstream benchmark numbers are useful for deciding what to test. They are never copied into a user's Token Harness savings total.

## Current evaluation order

| Priority | Mechanism / candidate class | Savings target | Current decision |
| --- | --- | --- | --- |
| **P0** | **Token Harness native adaptive policy** | Reasoning effort, verbosity and task/allowance budgeting | **Develop and benchmark first.** Broad coverage, no extra runtime dependency; change only at reviewed task/session boundaries and keep quality floors. |
| P0 | RTK | Shell/tool output noise | Supported on reviewed combinations; keep measuring marginal value rather than equating local output reduction with subscription saving. |
| P0 | HarnessTrim | Deterministic output/context reduction | Supported on reviewed combinations; same evidence rule as RTK. |
| P0 evidence | cclimits / native allowance readers | Make 5h/7d impact measurable | Read-only; never treated as an optimizer. |
| P0 evidence | ccusage / local history | Local workload evidence | Read-only; never promoted to subscription quota. |
| **P1 research** | **Repository-exploration reduction** — evaluate codebase-memory-mcp, CodeGraph and the native baseline | Avoid repeated grep/read/discovery work before it enters context | **Highest-priority external mechanism class to benchmark. No winner selected yet.** It is distinct from output compression, but must preserve exact source correctness and account for indexing/startup/residual-context cost. |
| **P1 conditional** | **MCP discovery/schema reduction** — mcptoon vs Atlassian mcp-compressor vs native Tool Search/deferred tools | Static MCP schema exposure | mcptoon detection is supported read-only, but **mcptoon is not the selected third optimizer**. Benchmark only where the native harness still exposes a material schema tax or its discovery path is unavailable/ineffective. |
| P2 research | Broad context owners — Headroom / Context Mode class | Long-session context ownership, virtualization and compaction | Admission-gated. Large theoretical surface, but substantial overlap, complexity and quality/attribution risk. |
| P2 research | Result-side encoders/compressors — mcptoon TOON, MCP Compressor result paths, similar tools | MCP/tool result payload | Compete against RTK/HarnessTrim on marginal paired value; do not stack by default. |
| P3 | API billed-token cost attribution | API money saved | Evidence gap; requires billed input/output tokens plus verified model pricing. |

## Why the external ranking changed

mcptoon remains worth observing, but the relevant baseline has changed. Modern Claude Code and Codex can defer/search MCP tools instead of necessarily serializing every MCP schema into every normal turn. Therefore a comparison of `all schemas loaded` versus `mcptoon compact index` can dramatically overstate the **marginal** saving a current Token Harness user would receive.

Token Harness will benchmark MCP discovery candidates against the **actual native tool surface of the installed harness/model/provider**. If native deferral already removes most of the tax, mcptoon stays an optional compatibility/special-case candidate rather than becoming a default third integration. Atlassian mcp-compressor belongs in the same comparison set rather than being ignored because mcptoon was evaluated first.

Repository exploration is currently the more interesting external mechanism class because it attacks another cost entirely: repeated code discovery and file reads before output reducers can help. Projects such as codebase-memory-mcp and CodeGraph make this testable, but neither is pre-selected. Their benchmark must include correctness/source verification, tool calls, provider allowance/cost when observable, indexing/startup overhead and residual context across longer sessions.

## Native adaptive policy is a real savings mechanism

The next development priority is not necessarily another installed tool. Token Harness already understands task class, allowance, model settings, reasoning effort and verbosity. Turning that into a conservative, evidence-backed policy at **task/session boundaries** can avoid overspending thinking/output on simple work without introducing a proxy or compressor.

This mechanism counts toward the promotion target only when it is more than a settings screen: it must have paired task evidence, measurable value, a quality floor, reviewed changes, and a safe rollback path. Token Harness should avoid changing effort repeatedly inside one task when that could damage prompt-cache continuity or produce unstable behavior.

## Capability ownership rule

Token Harness should avoid stacks that make savings and quality impossible to attribute:

- model/reasoning/verbosity policy: Token Harness native policy;
- repository exploration / structural retrieval: at most one admitted graph/index owner by default;
- MCP discovery/schema: native harness discovery first, then one external owner only if it proves material marginal value;
- shell/tool result reduction: RTK / HarnessTrim / result-side candidates compete on measured marginal value;
- broad context ownership: one Headroom/Context Mode-class owner only after admission;
- allowance and billing evidence: read-only observers.

Composition is allowed only when a paired benchmark proves additional quality-safe marginal value over each component alone.

## Stable versus promotion-ready

Technical stability and broad-promotion readiness are separate. Broad promotion should wait until Token Harness has at least **three distinct, genuinely useful, quality-gated savings mechanisms**, but the third mechanism is deliberately **not named in advance**.

RTK and HarnessTrim are current supported reducers. The third slot goes to whichever distinct mechanism wins controlled Token Harness evidence — potentially the native adaptive policy, repository-exploration reduction, an MCP discovery optimizer, or another candidate found later. A detection-only integration never counts.

The authoritative promotion checklist is [release-readiness.md](release-readiness.md). Green cross-platform CI, a verified published package, fresh-user end-to-end validation, and evidence-backed value reporting are required regardless of which third mechanism wins.

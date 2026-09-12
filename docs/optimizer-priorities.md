# Optimization stack priorities

Token Harness is an **optimization stack manager**. Its job is not to rebuild every token-saving
algorithm or continuously toggle deterministic tools. It should find the strongest compatible
components, install/configure them safely, verify them, measure their marginal value, keep them
healthy/up to date, and re-evaluate the stack when something meaningful changes.

The architectural contract is [RFC 0027](rfcs/0027-optimization-stack-manager.md).

## Product priority

The primary development loop is:

`discover → evaluate → recommend → install/configure → verify → measure → monitor → update/re-evaluate → rollback`

A strong external project should normally remain external. Token Harness gains leverage from its
contributors and releases instead of forking/reimplementing the same intelligence. Thin adapters,
compatibility metadata, evidence import and safe lifecycle management are preferred.

HarnessTrim is first-party and may eventually be embedded if that simplifies the product. That is a
special maintenance decision, not a reason to copy RTK, Caveman, Headroom or other healthy external
projects into Token Harness.

## Selection rule

Every candidate is scored on the same dimensions before it is promoted:

1. **Marginal savings** — value added after current Claude/Codex native behavior and the user's
   already-active stack, not versus an artificially unoptimized baseline.
2. **Coverage** — how often the mechanism can help normal Claude Code and Codex workloads.
3. **Allowance / API relevance** — preference for effects that can be tied to authoritative provider
   allowance or billed-token evidence when available.
4. **Quality safety** — paired task quality, retries, failures and exact-answer/source-verification
   checks override raw savings.
5. **Distinctness** — overlapping compressors are penalized unless composition proves additional
   value.
6. **Operational cost** — latency, memory, indexing/startup cost and background work count against
   the saving.
7. **Reversibility and isolation** — preview, approval, verification and rollback must be possible for
   managed activation.
8. **Maturity and maintenance** — release activity, compatibility surface, license, failure history
   and likely adapter maintenance matter.
9. **Attribution** — Token Harness must be able to say what produced the observed result.

Upstream benchmark numbers are useful for deciding what to test. They are never copied into a user's
Token Harness savings total.

## Current stack and evidence components

| Component | Category | Current role |
| --- | --- | --- |
| **RTK** | shell/tool output | Supported best-of-breed integration on reviewed combinations. Prefer install-once/always-on when verified healthy and beneficial. |
| **HarnessTrim** | deterministic output/context reduction | Supported first-party integration. Keep separate or embed later based on product simplicity, not ideology. |
| **cclimits / native allowance readers** | 5h/7d evidence | Read-only evidence. Not an optimizer. |
| **ccusage / local history** | usage evidence | Read-only evidence. Not subscription quota. |
| **Headroom observation** | broad context ownership candidate | Read-only candidate observation and explicitly attributed benchmark evidence only. Not a managed optimizer. |
| **mcptoon observation** | MCP discovery candidate | Read-only candidate observation and explicitly attributed benchmark evidence only. Not a managed optimizer. |
| **GitNexus observation** | repository exploration / retrieval candidate | Read-only candidate observation and explicitly attributed benchmark evidence only. Not a managed optimizer. |

## Candidate benchmark evidence

Headroom, mcptoon and GitNexus use the same paired benchmark path. A benchmark started with an
explicit `--candidate` stores candidate identity in a sidecar beside the ordinary benchmark state;
the receipt schema and deterministic pair comparator stay unchanged. Candidate identity names the
**experiment target**. It does not prove that the candidate was installed, enabled or responsible
for an observed change.

`token-harness benchmark-matrix` groups only complete, valid, same-project benchmark pairs that also
have valid candidate attribution. The candidate evidence view reports, separately for each
candidate:

- pair verdict counts from the existing comparator;
- evidence-bearing pair count and coverage percentage;
- evidence classes, keeping backend quota, local evidence and quality-only evidence distinct;
- aggregate local-token deltas only where both sides have attributable local usage and passed
  quality;
- aggregate wall-clock deltas only where both baseline and optimized runs passed the quality gate.

Wall-clock time is useful operational evidence, but it is not provider allowance and does not alter
the benchmark verdict. Missing or incomplete evidence remains unknown rather than being estimated.
The candidate evidence view deliberately emits **no composite score, winner, activation decision or
promotion recommendation**. Promotion remains a separate product decision that also requires
compatibility, distinctness, operational cost, verification and reversibility evidence.

The guided campaign now projects that selection evidence through the same promotion-readiness gates
shown on the candidate card. An explicit **Compare evaluation evidence** action can read only saved
candidate/harness campaigns and place their progress, selection signal, decision readiness and gate
state side by side. It is intentionally on-demand, does not create missing campaigns or trigger a
second environment scan, and preserves fixed candidate/harness ordering instead of ranking by a
synthetic score.

## Candidate research queue

The queue is category-first. No project owns a roadmap slot merely because it was suggested first.
Within each category Token Harness should compare the strongest credible projects against the actual
native/current-stack baseline.

| Research tier | Waste surface | Candidate examples | What must be proven |
| --- | --- | --- | --- |
| **P1** | **Third distinct stack mechanism** | best candidate across the categories below | Material marginal saving, quality safety, real activation/verification/rollback and combined-stack value. No winner selected yet. |
| P1 | repository exploration / retrieval | code graph/index/memory approaches vs native grep/read | Fewer repeated discovery reads/tool calls/context while preserving exact source correctness; include indexing/startup cost. |
| P1 | MCP schema/discovery | native Tool Search/deferred loading, mcptoon, mcp-compressor class | External layer must beat the installed native harness baseline, not an all-schemas-loaded straw baseline. |
| P1 | context/prompt/output minimization | Caveman-class systems and other maintained specialized optimizers | Measure which surface is actually changed, overlap with RTK/HarnessTrim, task quality and marginal allowance/context value. |
| P2 | broad context ownership | Headroom / Context Mode-class systems | Large potential surface but higher overlap, latency, attribution and quality risk; at most one broad owner by default. |
| P2 | result-side encoding/compression | TOON/result encoders, MCP result compressors | Must add material value after RTK/HarnessTrim and avoid lossy compression cascades. |
| P2 | native model/reasoning/verbosity | Token Harness policies over supported native controls | Useful secondary policy, not a substitute for integrating strong external optimizers. Dynamic switching only when task/allowance evidence justifies it. |
| P3 | API billed-token cost attribution | billing/price evidence | Requires attributable billed input/output tokens plus verified pricing before money claims. |

This ranking is intentionally revisable. A newly maintained project can move ahead when evidence
shows a larger uncovered waste surface or a better quality-safe implementation.

## Install once versus runtime policy

The default for an admitted deterministic optimizer is:

**install → configure → verify → leave enabled → monitor.**

Token Harness should not make a per-command decision simply because it can. Constant retuning adds
failure modes and weakens attribution.

Runtime decisioning is reserved for cases where the best choice genuinely changes with runtime
state, for example:

- reasoning/model/verbosity as task difficulty and verified allowance change;
- mutually exclusive aggressive/lossy modes with different quality risk;
- explicit cross-harness workload allocation when the user supplied a backlog and comparable evidence
  exists.

Even these begin as recommendations and become automatic only if opt-in and benchmark evidence make
that complexity worthwhile.

## Capability ownership and composition

Token Harness should avoid stacks that make savings and quality impossible to attribute:

- shell/tool output: one or more components only when their scopes are demonstrably complementary;
- repository exploration / structural retrieval: at most one primary graph/index owner by default;
- MCP discovery/schema: native harness discovery first, then one external owner only if it proves
  material marginal value;
- result compression: no RTK → HarnessTrim → TOON-style cascade by default;
- broad context ownership: at most one Headroom/Context Mode-class owner by default;
- model/reasoning/verbosity: Token Harness may own supported native policy settings;
- allowance/history: read-only observers never own optimization surfaces.

Composition is admitted only when the **combined stack** beats the existing stack with quality held
safe. Testing each component independently is not enough.

## Re-evaluation policy

A healthy stack should remain stable. Token Harness re-evaluates when:

- Claude Code/Codex or a relevant optimizer changes version;
- configuration drift or a verification failure appears;
- measured saving deteriorates or quality regresses;
- workload shape materially changes, such as many new MCP tools or a different repository profile;
- a credible new candidate appears in a relevant category;
- the user explicitly requests setup/update/benchmark review.

Foreground checks on app open or explicit refresh are the default. A permanent background daemon is
not required unless future evidence proves it useful.

## Promotion target

Technical stability and broad-promotion readiness remain separate.

Before broad promotion Token Harness should present a compelling **managed optimization stack** with
at least three distinct useful savings mechanisms. A counted mechanism must be usable, verifiable,
measurable in the correct evidence class and reversible/owned appropriately. Detection-only
candidates do not count.

The third mechanism is deliberately unnamed until comparative evidence selects it. More important
than the number three is that Token Harness can demonstrate its actual product value:

- it finds and sets up useful optimization components;
- the components continue to evolve in their own projects where appropriate;
- Token Harness tells the user whether the stack is healthy and current;
- it measures what each component and the combined stack are actually doing;
- it recommends a change only when evidence says the change is worthwhile.

The authoritative promotion checklist is [release-readiness.md](release-readiness.md).

# RFC 0027 — Optimization stack manager

- Status: Accepted
- Date: 2026-09-09
- Owners: Token Harness
- Target: current product direction

## Summary

Token Harness is primarily an **optimization stack manager** for coding agents, not a runtime
orchestrator that continuously toggles independent optimizers and not a reimplementation of the
best algorithms maintained by other projects.

The product should discover the user's Claude Code/Codex environment, identify the strongest
compatible optimization components, install/configure supported components through reviewed
transactions, verify that they are actually active, measure their attributable value, monitor
health/version drift, and re-evaluate the stack when evidence or the environment materially changes.

Most admitted optimizers should then run independently and remain enabled. Runtime policy is a
smaller secondary layer used only where a decision genuinely changes with task, allowance, or
quality risk and where evidence shows that dynamic switching is worth the complexity.

This RFC refines the product emphasis of RFC 0011. Its quota, quality, attribution and cross-harness
contracts remain useful; the word **orchestration** must not be interpreted as a requirement to
continually enable/disable every optimizer during normal coding.

## Product thesis

Specialized open-source projects can invest far more deeply in one optimization mechanism than
Token Harness should attempt to duplicate. RTK is the canonical example: if RTK remains the best
reviewed shell/tool-output optimizer, Token Harness should integrate and maintain RTK rather than
copying its implementation.

Token Harness creates value above those projects by answering questions that no single optimizer
can answer on its own:

1. Which optimization components are useful for this installed harness and version?
2. Which are already present, configured correctly, healthy, outdated, conflicting or redundant?
3. What marginal saving does each component add on top of the user's current stack?
4. Did that saving preserve task quality?
5. Which version/composition is reviewed and reversible?
6. Has a harness/tool update made yesterday's recommendation stale?
7. Is there a better component in the same optimization category now?

The desired user experience is therefore closer to a package/health manager with evidence than to a
continuous agent supervising every command.

## Core lifecycle

For each supported component Token Harness should be able to advance through explicit states:

`discover → evaluate → recommend → install/configure → verify → measure → monitor → update/re-evaluate → rollback/uninstall`

These stages have different safety requirements:

- **Discover** is read-only. Detect executable/version/configuration/capabilities without adopting
  ownership.
- **Evaluate** uses local capability checks and, where needed, quality-gated paired benchmarks.
  Upstream benchmark claims are evidence for what to test, not user savings.
- **Recommend** explains expected benefit, overlap, confidence and trade-offs. Detection alone is not
  a recommendation.
- **Install/configure** uses the existing preview → approval → apply transaction model. Token Harness
  never silently mutates an unsupported version combination.
- **Verify** proves the configured path to the strongest available verification tier and reports
  `not-exercised` separately from failure.
- **Measure** keeps provider/measurement classes separate and attributes only evidence produced by
  the active component or an accepted paired benchmark.
- **Monitor** checks health, drift and versions when Token Harness is opened or explicitly asked. It
  does not require a permanent background daemon.
- **Update/re-evaluate** is triggered by meaningful change, not by constant retuning.
- **Rollback/uninstall** preserves the existing ownership and transaction guarantees.

## Default: install once, leave it alone

A component that is deterministic, low-risk, non-conflicting and consistently beneficial should be
an **always-on stack component** after admission.

RTK illustrates the intended model. If a reviewed RTK integration is active, healthy and still adds
material quality-safe value, Token Harness has no reason to decide before every shell command whether
RTK should run. The optimizer owns that mechanism and evolves in its own repository.

Token Harness should prefer a stable stack over repeated micro-adjustments because unnecessary
runtime switching adds failure modes, makes attribution harder, can disturb caches, and makes the
product harder to understand.

## When runtime policy is justified

Dynamic policy remains valid only when the optimal choice genuinely depends on runtime state.
Examples include:

- native reasoning effort/model/verbosity when task difficulty or remaining allowance materially
  changes the quality-per-allowance trade-off;
- choosing between mutually exclusive lossy/aggressive modes when task quality risk differs;
- explicit cross-harness workload scheduling when the user supplies a backlog and both harnesses have
  comparable quality/capacity evidence.

Even in these cases Token Harness starts as a recommendation engine. Automatic switching must be
opt-in, version-gated, benchmarked and reversible. A feature is not made dynamic merely because it
can be.

## Component model

Third-party projects remain independent dependencies behind thin adapters. Token Harness should
avoid forks or reimplementations unless there is a compelling maintenance/safety reason.

A component adapter may provide:

- detection and version/capability observation;
- reviewed install/configure/update actions;
- live/config verification;
- metrics/evidence import;
- compatibility/conflict metadata;
- benchmark hooks where the upstream project cannot provide attributable evidence itself.

First-party mechanisms are allowed. HarnessTrim, for example, may remain a separate project or be
embedded later because it is controlled by the same maintainers. That is an implementation choice,
not a precedent for copying RTK or other healthy specialized projects into Token Harness.

## Optimization categories

Token Harness evaluates candidates by the waste surface they address. Multiple projects may compete
inside one category; the product does not need every available project installed.

Current categories include:

| Category | Examples | Default policy |
| --- | --- | --- |
| shell/tool output | RTK, HarnessTrim paths | admit the best compatible quality-safe component(s); avoid redundant transforms |
| MCP schema/discovery | native deferred/tool search, mcptoon, mcp-compressor class | use native baseline first; add an external component only for measured marginal tax |
| MCP/tool result payload | RTK/HarnessTrim/result encoders | benchmark marginal composition; no compression cascade by default |
| broad context ownership | Headroom/Context Mode-class systems | at most one owner by default; strong admission gate |
| repository exploration | native grep/read, structural/index/graph systems | compare source correctness, indexing cost, tool calls, context and provider evidence |
| native model/reasoning | Claude/Codex native controls | Token Harness policy may manage reviewed settings; runtime adaptation only with evidence |
| allowance/history evidence | native readers, cclimits, ccusage | read-only evidence; never counted as an optimizer |

The integration target is the **best useful stack**, not the largest catalogue.

## Ranking candidates

A candidate is ranked by marginal value over the actual current stack, not by an upstream headline
percentage. Important dimensions are:

1. useful-work/allowance or billed-token impact when authoritative evidence exists;
2. quality and correctness under paired tasks;
3. marginal local context/output reduction where provider evidence is unavailable;
4. workload coverage;
5. distinctness from components already active;
6. latency, memory, indexing/startup and operational cost;
7. compatibility, reversibility and failure isolation;
8. project maturity, release activity, license and maintenance burden;
9. measurement attribution.

Token Harness may support detection for a candidate before selecting it. Detection is cheap optional
knowledge, not a promise that the component will be recommended or managed.

## Re-evaluation triggers

A healthy stack should not be continuously re-optimized. Re-evaluate when one of these occurs:

- Claude Code/Codex changes version or relevant native capabilities;
- an installed optimization component changes version;
- configuration drift or verification failure is observed;
- measured savings materially deteriorate or quality regresses;
- a new candidate becomes credible in a category the user actually needs;
- MCP/repository/tool workload changes enough to invalidate prior evidence;
- the user explicitly requests `check`, update, benchmark or setup review.

A periodic background service is not required for the product thesis. Foreground checks on app open,
explicit refresh/update checks, and event-driven re-evaluation are sufficient unless later evidence
shows that background monitoring adds real value.

## UI consequence

The primary user object should become **Your optimization stack** rather than a collection of raw
settings.

For each component the app should communicate:

- installed/configured/verified state;
- version and whether a reviewed update is available;
- optimization category and what it changes;
- measured saving with measurement class and sample size;
- quality status/confidence;
- health/drift/conflict status;
- recommended action only when action is actually useful.

A candidate that was tested but not recommended should be explainable, for example:
`Headroom — +3% marginal reduction, +11% latency: not recommended`.

The normal steady state should be boring: the stack is healthy, components are up to date, measured
value is visible, and the user keeps coding.

## Promotion gate

Broad promotion should wait for a compelling **managed stack**, not an arbitrary number of detected
projects.

Before Token Harness is labelled promotion-ready it should have at least three distinct useful
savings mechanisms available through the product, with the following minimum bar:

- at least two are independently maintained best-of-breed integrations or otherwise clearly distinct
  mechanisms rather than cosmetic variants of one reducer;
- each counted mechanism has a real activation path, verification and rollback/ownership story;
- measured value is available in its correct measurement class and unsupported subscription/API
  conversions stay unavailable;
- quality-sensitive mechanisms have paired quality evidence;
- the combined recommended stack has been validated, not merely each component in isolation;
- cross-platform CI and published-package fresh-install validation are green.

The third mechanism is deliberately unnamed. mcptoon, repository-exploration tools, Headroom,
Caveman-class systems, a native Token Harness policy, or a future project can qualify only by winning
comparative evidence for a useful category.

## Non-goals

- reimplementing healthy external optimizers merely to own their code;
- installing every known optimization project;
- continuously toggling deterministic always-beneficial tools;
- stacking multiple lossy compressors because each claims a large standalone percentage;
- converting local token/context reductions into opaque subscription quota or money without evidence;
- requiring an always-running Token Harness daemon for normal optimizer operation;
- making users understand the internal optimizer ecosystem before they can benefit from it.

## Relationship to earlier RFCs

RFCs 0002, 0003, 0004, 0005, 0007 and 0009 remain the foundation for provider contracts,
capability ownership, safe mutation, attribution, verification and managed lifecycle.

RFC 0011 remains authoritative for quota observations, quality-per-allowance goals and explicit
cross-harness scheduling contracts, but this RFC narrows its product interpretation: **continuous
runtime orchestration is not the default operating model**. The preferred model is a stable,
measured optimization stack with re-evaluation on meaningful change.

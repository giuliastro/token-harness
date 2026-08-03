# Provider and harness landscape

Research snapshot: **2026-07-31**. Harness section added **2026-08-03**.

This document is the researched intake queue for Token Harness providers and harnesses. It is
not a support matrix: only adapters in `packages/adapters/src/providers` and
`packages/adapters/src/harnesses` are supported by the current build. Upstream measurements
below are discovery evidence, not Token Harness benchmark results.

## Recommendation

The strongest additions are the ones that operate on a different source of waste from
RTK and HarnessTrim:

1. **Dejavu** for repeated-output deltas;
2. **Lazy MCP** for MCP schema loading on demand;
3. **repowise** for bounded, task-specific repository retrieval;
4. **LiteLLM** as the common gateway and telemetry seam for model routing;
5. **one routing policy owner**, initially evaluated between RouteLLM and vLLM Semantic
   Router;
6. **one broad context owner**, evaluated between Headroom and Context Mode;
7. **LLMLingua** as a compression engine only after a provider supplies the harness
   lifecycle around it;
8. **Caveman** as an explicit, opt-in output policy.

This order does not mean that every earlier item can be enabled together. The capability
resolver still fails closed until the exact provider pair, order, versions, and fixture
are recorded.

## Context and token reduction

| System | License | Intended capability | Why it adds value | Admission gates |
| --- | --- | --- | --- | --- |
| [Dejavu](https://github.com/Salnika/dejavu) | MIT | `shell.output.deduplicate` | Always runs the real command, preserves its exit code, and replaces unchanged or near-unchanged reruns with a recoverable delta. Upstream reports 52-55% less intercepted output in real sessions and 87% in repeated rerun loops. | Determine whether deduplication sees raw or RTK-reduced output; prove stage attribution and full-output recovery; native Windows is currently unsupported. |
| [Lazy MCP](https://github.com/voicetreelab/lazy-mcp) | MIT | `mcp.schema.lazy` | Exposes a small discovery surface and loads tool definitions on demand. Its published example avoided 34,000 tokens, 17% of a Claude Code context, by hiding two unused MCP tools. | Verify Windows packaging, recursive discovery, schema byte accounting, restoration of the original MCP registry, and brownfield proxy adoption. |
| [repowise](https://github.com/repowise-dev/repowise) | AGPL-3.0 | `repo.context.retrieve` | Serves task-shaped repository context over MCP instead of repeated search and file reads. Upstream reports a paired 2,391-vs-64,039-token context-loading result at answer parity. | External-only distribution; cap response size; verify index staleness and offline/local modes; add a quality and attribution fixture before composing with a general context provider. |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | Apache-2.0 | `tool.output.reduce`, `conversation.compact`, `model.output.terse`, `reasoning.effort.route` | Offers a library, OpenAI-compatible proxy, MCP server, and wrappers for Claude Code, Codex, OpenCode, and other agents. Upstream reports 15-20% fewer tokens for coding agents and 60-95% for JSON. | Establish which features can be independently disabled; test proxy and hook ownership; do not co-enable payload compression with RTK, HarnessTrim, or Context Mode without pair-specific fixtures. |
| [Context Mode](https://github.com/mksglu/context-mode) | Elastic-2.0, source-available | `mcp.result.sandbox`, `tool.output.reduce`, `conversation.compact` | Sandboxes raw tool/MCP payloads, exposes search/extraction tools, and persists compact session memory across many coding agents. Upstream reports about 98% reduction with hooks and 60% without them. | Licensing review; treat Headroom as an alternative; verify secret redaction, raw-data retention/deletion, hook enablement, and exact behavior on all three managed harnesses. |
| [LLMLingua](https://github.com/microsoft/LLMLingua) | MIT | likely `conversation.compact`; otherwise a new prompt-compression capability | A mature prompt-compression engine with code and long-context examples; upstream reports up to 20x compression with minimal performance loss. | It is a library, not a complete provider lifecycle. Do not bundle its models by default. A provider must add plan/apply/verify/rollback, CPU/GPU requirements, recovery, and coding-specific must-keep tests. |
| [Caveman](https://github.com/JuliusBrussee/caveman) | MIT | `model.output.terse` | Reduces visible model prose without touching code or tool input. Upstream reports 65% fewer output tokens and explicitly reports zero input-token savings. | Opt-in only; compare against a minimal terse instruction, include the instruction overhead, protect safety/confirmation prose, and measure task quality rather than word count alone. |

### Pairing policy

- Dejavu is the only shortlisted shell-layer system whose intended contribution is
  genuinely different from RTK's: cross-run memory rather than per-run semantic
  reduction. It still needs an ordered chain fixture.
- Lazy MCP is the cleanest orthogonal third provider because it changes schema exposure,
  not shell or tool results.
- repowise can follow one context provider only when its result envelope has a tested
  maximum and marginal savings can be attributed.
- Headroom and Context Mode are alternatives. Both can touch tool results, MCP payloads,
  memory, and response behavior; installing both as a "maximum savings" profile would
  violate the fail-closed model.
- LLMLingua is better treated as an engine used by a provider than as an upstream
  installation Token Harness pretends already has harness-aware rollback.

## Model routing and gateways

Model routing optimizes **cost, latency, capacity, or quality**. It does not necessarily
reduce input or output tokens. Token Harness must therefore keep routing outcomes out of
the exact/estimated token-saving totals unless the router exposes comparable token
measurements for both paths.

| System | License | Role | Why it adds value | Admission gates |
| --- | --- | --- | --- | --- |
| [LiteLLM](https://github.com/BerriAI/litellm) | MIT outside `enterprise/` | Gateway and telemetry substrate | Provides one self-hosted OpenAI-compatible surface for 100+ providers, with load balancing, retries/fallbacks, spend tracking, budgets, and usage logs. It is the most practical common seam beneath a routing policy. | Do not label load balancing as intelligent routing. Add credential redaction, endpoint ownership, per-request model receipts, uninstall/restore, and a hosted-egress warning. |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | Apache-2.0 | Learned strong/weak model router | Ships trained routers and an OpenAI-compatible server; upstream reports up to 85% cost reduction while retaining 95% GPT-4 performance on general benchmarks and already uses LiteLLM for model access. | Recalibrate on coding-agent turns, tool calls, and long sessions; record the chosen model per operation; A/B task success; treat the generic benchmark as insufficient for a default coding profile. |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | Apache-2.0 | Self-hosted mixture-of-models router | Actively targets model, reasoning, and tool selection plus semantic caching across heterogeneous local/private/cloud inference. It is the better fit for teams already running vLLM infrastructure. | Heavy deployment footprint; separate desktop and fleet support; prove cache identity and privacy; make it an alternative owner to RouteLLM, not a second router in the same request path. |

### Required architecture work before any router adapter

The current taxonomy has `reasoning.effort.route`, which changes effort on a selected
model. Choosing a different model or provider is a new interception and attribution
surface. Per RFC 0003, router admission therefore requires an RFC that adds a capability
such as `model.request.route` and defines:

- exactly one routing-policy owner per model request;
- gateway-only behavior versus quality/complexity routing;
- the chosen model, fallback chain, cache hit, latency, billed tokens, and billed cost in
  a receipt without storing prompts;
- a cost/quality report separate from token-reduction measurement classes;
- A/B task-success gates for coding sessions;
- credential, prompt-egress, and data-residency diagnostics;
- plan, apply, verification, rollback, and brownfield adoption for endpoint changes.

Hosted routers such as [Not Diamond](https://docs.notdiamond.ai/docs/what-is-model-routing)
and [OpenRouter Auto](https://openrouter.ai/openrouter/auto) remain later opt-in candidates.
They can add value, but prompt egress, provider terms, credentials, and independently
verifiable routing receipts make them a worse first fit for a local-first default.

## Deliberate exclusions from the first wave

- Another generic shell-output compressor is not complementary enough while RTK and
  HarnessTrim coverage is still incomplete. It would add another claimant on the same
  exclusive surface without adding a new capability.
- A provider is not admitted from a marketing percentage. Every upstream number above
  must be reproduced on committed fixtures and then classified under RFC 0005.
- A gateway is not a savings provider merely because it exposes cheaper models. The
  selected model and the counterfactual baseline must both be observable before a cost
  claim is made.
- Source-available and copyleft tools may be managed externally, but are not bundled
  without the licensing review required by RFC 0001.

## Harness landscape

PLAN §9.2 admits a harness through its own sequence, and this is that queue. A harness earns a
place here by having an *observable interception point*, which is a different claim from being a
popular coding agent: Token Harness can only own what a harness exposes deterministically.

The build supports three — `claude`, `codex`, `opencode`. The rest are candidates.

### Evidence in hand

| Harness | Interception evidence | What is still missing | Note |
| --- | --- | --- | --- |
| [Hermes Agent](https://github.com/giuliastro/HarnessTrim) | HarnessTrim ships a plugin adapter, installed by `harnesstrim install hermes` | Config schema and paths, tool families, tested version range, verification tier, fixture suite | HarnessTrim's manifest already declares `~/.hermes/harnesstrim-metrics.jsonl` among its metrics locations, so this path is read today by a build with no Hermes adapter |
| [PI](https://pi.dev/) | HarnessTrim ships an extension, installed by `harnesstrim install pi`; `harness-remote` reaches it over ACP through `@automatalabs/pi-acp` | The same list, plus whether the extension point yields an observable receipt or stops at `config-only` | Reported as unmanaged context by the current build |
| [Oh My Pi (OMP)](https://omp.sh/) | A local bridge in `harness-remote` | An interception point. A control bridge shows the harness can be *driven*, not that a payload can be intercepted | Detection-only until an interception point is observed on a real installation |

### Named, not yet researched

Gemini CLI, GitHub Copilot CLI, Cursor CLI, Amp, Crush, and Cline are listed so the queue is
explicit about its own edges. Nothing has been observed about their interception points, config
schemas, or verification surfaces, and no row above may be written for them from a feature list.

### Admission gates common to every harness

- an interception point observed on a real installation, not inferred from documentation;
- a config schema with a parser that round-trips unrelated content, including comments where the
  format carries them;
- a declared verification tier per RFC 0007, `config-only` where nothing is observable;
- absent, partial, healthy, broken, user-modified and brownfield fixtures;
- no provider claims the harness until that provider's fixture on it passes;
- `metrics` never imports from a harness path the registry does not know.

## Source notes

Primary upstream sources reviewed for this snapshot:

- [Dejavu README and limitations](https://github.com/Salnika/dejavu)
- [Lazy MCP README](https://github.com/voicetreelab/lazy-mcp)
- [repowise MCP guide](https://www.repowise.dev/guides/ai-context-mcp)
- [Headroom README](https://github.com/headroomlabs-ai/headroom)
- [Context Mode README and platform matrix](https://github.com/mksglu/context-mode)
- [LLMLingua README and papers](https://github.com/microsoft/LLMLingua)
- [Caveman README](https://github.com/JuliusBrussee/caveman)
- [LiteLLM README and license](https://github.com/BerriAI/litellm)
- [RouteLLM README](https://github.com/lm-sys/RouteLLM)
- [vLLM Semantic Router README](https://github.com/vllm-project/semantic-router)

For the harness section:

- [HarnessTrim README, adapter install commands](https://github.com/giuliastro/HarnessTrim)
- [harness-remote README, supported-harness table and bridge setup](https://github.com/giuliastro/harness-remote)
- `packages/adapters/src/providers/harnesstrim.ts`, for the metrics locations the build declares

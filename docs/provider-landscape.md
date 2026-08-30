# Provider and harness landscape

Research snapshot: **2026-08-30**. Harness section added **2026-08-03**. Quota-aware and routing priorities refreshed
**2026-08-30**.

This document is the researched intake queue for Token Harness providers and harnesses. It is
not a support matrix: only adapters in `packages/adapters/src/providers` and
`packages/adapters/src/harnesses` are supported by the current build. Upstream measurements
below are discovery evidence, not Token Harness benchmark results.

## Recommendation

Token Harness is now optimizing **useful work per included Claude Code/Codex allowance**, not token
count in isolation. The intake order therefore starts with native quota and context controls before
adding more payload-transforming providers:

1. **native quota observability** — Claude Code's supported usage/status surfaces and Codex
   app-server rate-limit RPCs;
2. **native model/effort/context policy** — use the harness's own model, reasoning, verbosity,
   compaction, instruction, and tool controls before introducing another proxy;
3. **ccusage** as a read-only historical telemetry companion for local Claude Code and Codex
   sessions;
4. **RTK + HarnessTrim** on the already proven, non-overlapping reduction surfaces;
5. **Lazy MCP**, but benchmark it against native deferred/tool-search behavior before assigning the
   MCP-schema channel;
6. **one broad context owner**, evaluated between Headroom and Context Mode;
7. **Dejavu** for repeated-output deltas after the ordinary output path has been measured;
8. **repowise** only where paired tests prove its retrieval envelope costs less context than it
   avoids;
9. **generic model routers** only as explicit overflow/API-cost policy, not as a core way to improve
   subscription quota;
10. **LLMLingua and Caveman** only after native compaction/verbosity/effort controls have been
    exhausted and quality-preservation fixtures justify another owner.

This is both a ranking by expected quota impact and an implementation order. A provider still fails
closed until the exact capability owner, order, versions, rollback behavior, and measurement class
are known.

## Quota observability and native control

These surfaces are different from providers: they are controls already exposed by the harness and
should be preferred because they do not add another interception layer.

| Surface | Role | Admission rule |
| --- | --- | --- |
| Claude Code native usage/model/context controls | Observe plan usage and reset information; select model and effort; inspect or reduce long-session context | **P0 internal adapter.** Prefer supported CLI/user-visible surfaces. Do not scrape or reuse OAuth credentials merely to obtain a prettier meter. Unknown live quota is an acceptable result |
| Codex app-server `account/rateLimits/read` and updates | Structured current usage, window duration, reset timestamp, reached-limit state, and reset-credit inventory | **P0 internal adapter.** Read-only first. Never redeem a reset credit automatically, and never infer model-to-bucket mappings the server does not expose |
| Codex native config profiles | Model, reasoning effort, plan-mode effort, verbosity, instruction budget, tool-output budget, and MCP/tool deferral | **P0 internal policy surface.** Discover supported fields/models from the installed Codex version and preserve user-owned configuration |
| [ccusage](https://github.com/ccusage/ccusage) | Local daily/weekly/monthly/session token and estimated-cost history across Claude Code and Codex | **P0 read-only companion.** MIT, local and read-only. Historical token activity is evidence for trends, not proof of the subscription backend's remaining quota |
| Token Harness budget controller | Pace five-hour and weekly headroom against reset time; recommend economy/balanced/quality choices | **New core capability.** Recommendations first; managed mutation only after the native control and rollback contracts are versioned |

The backend meter remains authoritative. A local token count can explain *why* a task was expensive,
but Token Harness must not manufacture an exact conversion from tokens to subscription percentage
unless the harness exposes one.

## Context and token reduction

| System | License | Intended capability | Why it adds value | Admission gates |
| --- | --- | --- | --- | --- |
| [Dejavu](https://github.com/Salnika/dejavu) | MIT | `shell.output.deduplicate` | Always runs the real command, preserves its exit code, and replaces unchanged or near-unchanged reruns with a recoverable delta. Upstream reports 52-55% less intercepted output in real sessions and 87% in repeated rerun loops. | Determine whether deduplication sees raw or RTK-reduced output; prove stage attribution and full-output recovery; native Windows is currently unsupported. |
| [Lazy MCP](https://gitlab.com/gitlab-org/ai/lazy-mcp) | MIT | `mcp.schema.lazy` | A client-agnostic proxy that aggregates downstream MCP servers behind meta-tools and loads definitions on demand. Its README claims ~90% initial context reduction, ~16K tokens to ~1.5K. That figure is upstream's and is not yet measured here. | Measure the schema bytes actually avoided rather than repeating the claim; recursive discovery; restoration of the original MCP registry; brownfield proxy adoption. |
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
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | MIT | Agent-native model gateway for coding agents | One local endpoint for Claude Code, Codex, OpenCode, and other agents, with effort- and request-conditioned routing rules, ordered fallback chains, and request logs carrying the resolved route, latency, tokens, and estimated cost. It speaks to exactly the harnesses Token Harness manages and is distributed as an npm CLI, so it shares the platform and packaging expectations of this project. **Overflow-only candidate.** | It rewrites the same agent configuration surfaces Token Harness owns and holds credentials, so endpoint and profile ownership must be resolved before mutation. Confirm detection of a user-run instance on `127.0.0.1:3456`, a read-only adoption path for its routing rules and logs, credential redaction, and that routing outcomes stay out of the token-saving totals. Requires the model-routing RFC below before a manifest. |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | Apache-2.0 | Learned strong/weak model router | Ships trained routers and an OpenAI-compatible server; upstream reports up to 85% cost reduction while retaining 95% GPT-4 performance on general benchmarks and already uses LiteLLM for model access. | Recalibrate on coding-agent turns, tool calls, and long sessions; record the chosen model per operation; A/B task success; treat the generic benchmark as insufficient for a default coding profile. |
| [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) | MIT | Effort-aware routing library and server | Selects the model per query by task complexity, cost, and quality across 16+ strategies (KNN, MLP, graph, Elo, multi-round, personalized), with training and data-generation pipelines plus an OpenAI-compatible serving surface. It is the most direct implementation of the "escalate only when the task needs it" tier model. **Overflow-only candidate.** | Evaluate as the effort-aware routing-policy owner against RouteLLM, not as a second router in the same request path. Verify the inference-server footprint and that routing decisions are observable per request without prompt egress; Python research stack needs a versioned, documented serving mode before plan/apply/verify can be built on it. |
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

Claude Code Router and LLMRouter remain local candidates under this RFC, but the quota-aware
roadmap does not schedule them before native model/effort/context policy. Neither is admitted before
the `model.request.route` capability and its cost/quality attribution class exist.

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
| [Hermes Agent](https://github.com/giuliastro/HarnessTrim) | HarnessTrim ships a plugin adapter, installed by `harnesstrim install hermes` | Config schema and paths, tool families, tested version range, verification tier, fixture suite | PLAN §15 item 25 removed `~/.hermes/harnesstrim-metrics.jsonl` from HarnessTrim's metrics locations until Hermes is admitted; item 30 restores it together with the adapter, a registry entry and a matrix row |
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

### Which Lazy MCP

Three unrelated projects publish under that name, and this table pointed at a fourth. The entry
originally cited `github.com/voicetreelab/lazy-mcp` and carried its published example — 34,000 tokens
avoided, 17% of a Claude Code context. That project exists and is maintained, but it is written in Go
and its install is `make build` followed by `claude mcp add` against the compiled binary: no packaged
distribution. §Admission gates makes Windows packaging a gate rather than a follow-up, and building
from source on Windows is that gate unresolved.

Meanwhile `npm install lazy-mcp` resolves to the GitLab project, which is a different tool with a
different configuration surface. `@lazy-mcp/cli` and `@rover3930/lazy-mcp` are two more, from two more
repositories. An adapter written against whichever one npm happened to install would have carried this
table's evidence while describing something the table never evaluated.

So the candidate is now the GitLab project explicitly, chosen because it clears the packaging gate
rather than defers it: Homebrew, `cargo`, `uvx`, and npm all install it, and it is MIT and actively
maintained. The 34,000-token example does not move with the name — it belonged to the other project
and has been replaced with upstream's own claim, marked as unmeasured.

Observed here at `2.7.2`, installed from npm: `--version` reports `2.7.2`; the CLI accepts `--config`,
`--port` and `--transport`; and it reads and writes `servers.json`, `tokens.json` and
`client-info.json` under a `lazy-mcp/` configuration directory that honours `XDG_CONFIG_HOME` and
otherwise defaults to `~/.config/lazy-mcp/`. The harness-side change it asks for is one aggregated
entry replacing the downstream servers, which is why "restoration of the original MCP registry" is the
gate that matters most.

## Source notes

Primary upstream sources reviewed for this snapshot:

Quota and native-control sources refreshed on 2026-08-30:

- [Claude plans and pricing](https://claude.com/pricing), for rolling five-hour and paid weekly usage limits.
- [Claude Code: Models, usage, and limits](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code), for model selection, `/clear`, `/compact`, `/context`, instruction hygiene, and Opus-plan/Sonnet-execute guidance.
- [Anthropic Agent SDK subscription update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), for the June 15 pause: `claude -p`, Agent SDK, and third-party Agent SDK usage still draw from subscription limits.
- [Codex pricing](https://chatgpt.com/codex/pricing/), for current five-hour model ranges, weekly-limit caveat, Luna guidance, prompt/AGENTS/MCP optimization guidance, and paid-credit separation.
- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md), for `account/rateLimits/read`, reset timestamps, and reset-credit inventory.
- [Codex config schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json), for native profiles, model/reasoning/verbosity, project-doc budget, tool-output budget, and tool-deferral feature discovery.
- [ccusage](https://github.com/ccusage/ccusage), for local read-only Claude Code/Codex token/session history.

- [Dejavu README and limitations](https://github.com/Salnika/dejavu)
- [Lazy MCP README](https://gitlab.com/gitlab-org/ai/lazy-mcp) — the GitLab project, published to npm as
  `lazy-mcp`. See §Which Lazy MCP.
- [repowise MCP guide](https://www.repowise.dev/guides/ai-context-mcp)
- [Headroom README](https://github.com/headroomlabs-ai/headroom)
- [Context Mode README and platform matrix](https://github.com/mksglu/context-mode)
- [LLMLingua README and papers](https://github.com/microsoft/LLMLingua)
- [Caveman README](https://github.com/JuliusBrussee/caveman)
- [LiteLLM README and license](https://github.com/BerriAI/litellm)
- [Claude Code Router README and license](https://github.com/musistudio/claude-code-router)
- [RouteLLM README](https://github.com/lm-sys/RouteLLM)
- [LLMRouter README and license](https://github.com/ulab-uiuc/LLMRouter)
- [vLLM Semantic Router README](https://github.com/vllm-project/semantic-router)

For the harness section:

- [HarnessTrim README, adapter install commands](https://github.com/giuliastro/HarnessTrim)
- [harness-remote README, supported-harness table and bridge setup](https://github.com/giuliastro/harness-remote)
- `packages/adapters/src/providers/harnesstrim.ts`, for the metrics locations the build declares

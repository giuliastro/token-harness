# RFC 0028 — Smart model routing, shadow-first

- Status: Accepted
- Date: 2026-09-24
- Owners: Token Harness

## Summary

Token Harness may classify each model request with a small, deterministic TypeScript heuristic and
use a compatible gateway to observe or, after explicit opt-in, route selected requests. The first
implementation uses Claude Code Router (CCR) as the request interception layer for Claude Code and
Codex. The default is **shadow mode**: classify and record a decision, then leave the current model
selection unchanged.

The classifier runs locally in the CCR script worker. It makes no API calls and requires no local
model, GPU, Jev account, or additional classifier service. A model provider configured in CCR may
still have its own credentials, pricing, and data-egress behavior; the classifier does not make
those choices or enable that provider.

This is a secondary runtime policy under RFC 0027. It does not replace native harness policy or
silently change user-owned harness configuration. Token Harness may install a reviewed CCR CLI
version into its own protected local state directory through npm, start its local gateway, and
explicitly update that owned copy. Installation/start and routing configuration use separate
preview/approval steps; no global CCR package is replaced. On a local CCR 3.1.1 service,
configuration uses CCR's authenticated loopback Web RPC and rollback removes only the exact rule
and optional profile it owns. If exactly one matching provider is already configured in CCR,
Token Harness may create a profile scoped to CCR CLI launches; provider login/import remains an
explicit user action because it selects authentication and billing. Native Claude Code/Codex
endpoints are not changed. A new profile uses the provider's explicit default or a unique configured
model; otherwise `TOKEN_HARNESS_ROUTING_PROFILE_MODEL` must name the exact `Provider/model` alias.
Users launch through the scoped profile and verify real requests in CCR logs.

## Capability amendment

RFC 0003 adds `model.request.route` as an exclusive capability. One routing-policy owner may
rewrite a request's selected model at a given harness gateway. Shadow observers do not own this
capability because they do not rewrite a request.

`reasoning.effort.route` and `model.request.route` remain distinct. A model ID does not prove its
cost, quality, included-allowance treatment, protocol support, or tool compatibility.

## Classifier contract

- The classifier is deterministic, local, bounded, and explainable by stable reason codes.
- Inputs are limited to CCR's bounded last-user-text summary plus request metadata such as
  estimated input-token count, image presence, and tool-schema count. Previous conversation turns
  are not reconstructed, so a vague follow-up must stay at the standard tier or lower confidence.
- The prompt is transient classifier input. It is never included in the decision event, logs created
  by Token Harness, or an outbound classifier call.
- The output tiers are `simple`, `standard`, `complex`, and `critical`; tiers are task classes, not
  permanent provider model IDs.
- The classifier follows the explainable heuristic approach used by LiteLLM Auto Router v2: text
  length, code, technical terms, reasoning markers, simple-language indicators, multi-step
  patterns, and question count contribute to a bounded score. Token Harness owns its own TypeScript
  implementation and thresholds.
- Missing, empty, malformed, or ambiguous input must preserve the current model.

## Modes and safety

### Shadow default

Generated CCR rules use `shadow` by default. They record the proposed tier and candidate (when
configured) and return no model rewrite. Existing CCR rules and native harness model settings keep
their behavior.

### Conservative opt-in

`conservative` is an explicit script-generation choice. The first policy may return one user-configured
simple model only when all of these hold:

1. the classifier has high-confidence `simple` evidence and no code, technical, reasoning,
   multi-step, image, or ambiguous-follow-up signal;
2. the request text is short and one primary user message is available;
3. CCR exposes no tool schemas, or the user explicitly sets
   `TOKEN_HARNESS_ROUTING_ALLOW_TOOLS=true` after confirming that the selected model supports the
   active tool protocol;
4. `TOKEN_HARNESS_ROUTING_SIMPLE_MODEL` names a configured CCR model and differs from the incoming
   model. Managed configuration validates this exact `Provider/model` alias against CCR's provider
   catalog; it does not infer a cheap model from its name. A manually exported script relies on the
   user's CCR process environment for the same setting.

All other requests pass through unchanged. The initial version does not downgrade standard,
complex, or critical requests and does not select model IDs by name, infer prices, change provider,
or add a paid overflow fallback. The target is read from CCR's process environment and is never
invented by Token Harness.

CCR is supported here as a local gateway on the same machine and user account as Token Harness. If
CCR is remote or runs as another user, the generated rule cannot write to the local telemetry path;
the request still fails open, but local decision metrics are unavailable.

## Decision telemetry

Routing decisions use a schema-versioned local event separate from RFC 0005 `OptimizationEvent`.
An event may contain:

- event ID and timestamp;
- harness ID, mode, classifier version, tier, bounded score, confidence and reason codes;
- sanitized requested/candidate model IDs and whether CCR was asked to rewrite the model;
- prompt character count, CCR's input-token estimate, image/tool-schema counts and classifier
  latency.

It never contains prompt text, tool contents, paths, API keys, authorization headers, or raw CCR
request/response bodies. Schema-2 events may retain CCR's opaque local session identifier solely to
correlate request-usage metadata; the completed benchmark receipt omits that identifier. Telemetry
write failure does not block the CCR request. Users can inspect the event counts and explicitly
prune old local records.

Decision telemetry is not a savings measurement. It does not enter exact, estimated, counterfactual,
or end-to-end-billed token totals. The initial report always says **model savings: not measured**.

## Evidence required before savings or broad automatic routing

Any future savings claim or default routing policy needs a paired, quality-gated comparison that
records, for each decision, the actual resolved model and comparable provider-reported usage or
included-allowance evidence. It must also account for routing overhead, tool-protocol compatibility,
fallbacks, retries, latency, and task acceptance. API-equivalent price, subscription allowance, and
local token estimates remain separate evidence classes.

For local CCR 3.1.1, benchmark receipts can retain in-window per-model request/token totals and
CCR-recorded provider-cost estimates after dropping request bodies and session identifiers. The
paired comparator exposes these in a separate `ccrUsage` result and reveals deltas only when both
observations are complete and both quality gates pass. The benchmark matrix aggregates those
quality-passed observations by task class and overall, while reporting partial and quality-gated
pairs separately. CCR counters or estimated provider cost do not establish a reduction in Claude
or Codex subscription allowance, and they do not change the comparator's quota verdict. Live savings
require an operator-run paired task with real baseline and optimized receipts.

Automatic routing beyond the simple conservative gate stays opt-in, version-gated, reversible, and
disabled by default until that evidence exists. A routing owner or gateway that edits Claude Code or
Codex settings will later require the existing preview, approval, ownership, verification, and
rollback lifecycle before it can be a managed provider.

## Initial implementation boundary

The first implementation provides a pure classifier, a CCR script exporter for Claude Code and
Codex, feature-only local decision telemetry, a separate decision-count report, and deterministic
offline tests. Managed setup previews and installs the exact reviewed CCR CLI version locally when
no authenticated CCR service is available, then asks for a second preview before changing routing
configuration. Existing authenticated CCR services are connected to without adopting or updating
their external CLI installation. Configuration validates the script, saves only the owned rule and
optional CCR-scoped CLI profile, verifies both through the CCR API, and stores a local ownership
receipt for rollback. It never imports provider credentials. A successful setup verifies only the
local package, gateway, and saved configuration; it does not claim live-request or quota
verification. An explicit update command targets the reviewed version pin; discovery of a newer
upstream release alone does not silently update the package.

# Context-owner candidate review — 2026-09-09

Status: benchmark candidate selection only. No provider is admitted or installed by default.

## Why this review exists

RFC 0024 allows at most one broad context owner. Token Harness therefore needs to compare candidates against the existing RTK/HarnessTrim/native-policy stack rather than stacking reducers because each one advertises token savings.

The immediate goal is to choose which candidate deserves the first controlled A/B run. The decision to admit a provider comes later and remains quality/retry gated.

## Headroom

Repository: https://github.com/headroomlabs-ai/headroom

Observed strengths:

- Apache-2.0 licensing.
- Recent 0.36.0 release (2026-08-20).
- Direct `headroom wrap claude` and `headroom wrap codex` integration paths.
- Current troubleshooting material explicitly understands deferred tool search and distinguishes eager from on-demand MCP tools.
- Recent Codex-specific work avoids treating OpenAI tool-search deferral as something the proxy should blindly replace.
- A previously reported Windows proxy-loop failure is closed, so Windows remains testable rather than pre-excluded.

Risks / gates before adoption:

- `wrap` redirects model traffic through a local proxy, which is a materially larger interception surface than Token Harness's current read-only/advisory measurements.
- Claude custom-base-URL behavior has caused effective-context-window regressions in the past; 0.36.0 contains fixes, but Token Harness must test the exact current path rather than inherit the project's claim.
- Historical wrapper defaults briefly enabled a very aggressive compression profile without explicit opt-in. Token Harness must pin conservative settings during evaluation.
- Current repository material is inconsistent about anonymous outbound telemetry/beacon behavior. Benchmark execution must explicitly disable telemetry/beacon/network reporting and the provider cannot be admitted until the effective current behavior is unambiguous.

Decision: **first broad-context benchmark candidate**, not admitted.

## Context Mode

Repository: https://github.com/mksglu/context-mode

Observed strengths:

- Purpose-built coding-agent context protection with sandboxed tool output, indexed retrieval, session memory and routing hooks.
- Direct current installation paths for both Claude Code and Codex.
- Hook routing can prevent large-output tools from flooding context rather than relying only on after-the-fact compression.

Risks / gates before adoption:

- Elastic License 2.0 rather than a permissive OSS license. This does not prevent local evaluation, but it is a worse fit for a default managed dependency inside an Apache-2.0 project and needs explicit legal/product consideration before redistribution or deeper coupling.
- It registers a broad MCP + hook surface (including multiple lifecycle hooks and context tools). That overlaps more directly with Token Harness/HarnessTrim ownership and therefore requires a more complex conflict/rollback analysis.
- A broad routing layer can improve context while also changing tool-selection behavior; quality and retry effects therefore matter as much as token reduction.

Decision: **second benchmark candidate**. Keep as comparator; do not install alongside Headroom by default.

## Benchmark contract

The first A/B evaluation must use the normal Token Harness paired benchmark contract and the additive context witnesses introduced with this spike:

- same harness and task class;
- fixed model / reasoning effort / verbosity;
- explicit passed quality gate on both sides;
- attempts, failed attempts and runtime/provider errors recorded;
- live 5-hour/weekly backend quota compared only where the existing comparable-window rules allow it;
- local task tokens kept separate from provider quota;
- raw MCP inventory and effective static MCP exposure recorded separately;
- no provider claim based solely on its own reported savings counter.

A candidate that reduces local/context volume but increases quality failures or retries loses. A lower local token count never becomes a fabricated subscription-quota percentage.

## First controlled Headroom profile

If the install/runtime review passes, benchmark Headroom with the least invasive profile first:

- local proxy only;
- no paid/external model routing;
- no persistent memory;
- no learning that writes project instructions;
- outbound telemetry/beacon explicitly disabled;
- full message logging disabled;
- no aggressive savings profile unless a later, separate experiment explicitly tests it;
- native Codex tool-search deferral preserved rather than duplicated.

Only after that baseline has repeated quality-passed results should Token Harness consider a managed lifecycle/admission PR.

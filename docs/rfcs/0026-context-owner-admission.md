# RFC 0026 — Context owner admission gate

Status: Draft

## Decision

A broad context owner such as Headroom or Context Mode is not eligible for recommendation or managed installation merely because it reports token savings or exposes fewer tools. Token Harness admits a candidate only from repeated paired task evidence collected by its own benchmark contract.

For one harness and task class, admission requires at least three recent comparable baseline/optimized pairs where:

- both variants pass the explicit quality gate;
- each variant's context surface is stable from task start to finish;
- context exposure is `reduced` in every admitted pair;
- no historical paired benchmark verdict says the baseline is better;
- failed attempts, total attempts, and runtime/provider errors do not regress;
- backend subscription quota, when comparable, is not worse for the candidate;
- local-token reductions remain local evidence and never become subscription quota.

Evidence is project-local upstream of this gate and this gate itself does not pool different harnesses or task classes. Missing, truncated, drifting, stale, or otherwise unknown context evidence cannot count toward admission.

Admission means **eligible for an experimental, reversible integration**. It does not make the candidate a default provider and does not authorize silent installation.

## Why

Broad context owners sit in a high-leverage part of the agent path. A proxy or context engine can reduce repeated payloads, but it can also hide tool output, trigger retries, interfere with native deferred-tool loading, or alter context-window behavior. A context reduction that causes more retries or worse backend allowance consumption is not an optimization.

The gate therefore evaluates the complete quality-per-allowance envelope while keeping context shape as a separate evidence class.

## Candidate rollout

The first candidate to pass through this gate is Headroom. Context Mode remains a second candidate. Their own published savings metrics are discovery evidence only; Token Harness benchmark receipts are the admission authority.

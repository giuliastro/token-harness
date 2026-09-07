# Managed Codex model policy milestone

Date: 2026-09-07  
RFC: [0019](../rfcs/0019-managed-codex-model-policy.md)

## What changed

Token Harness can now turn a **learned Codex model recommendation** into a reviewed native configuration action. This is the mutation follow-up to RFC 0018; it does not add another model-ranking heuristic.

The path is deliberately narrow:

1. project-local paired benchmark history proves a model alternative under RFC 0018;
2. `optimize` keeps reasoning effort and verbosity fixed and emits the learned model recommendation;
3. `plan --native-policy` freezes that advice and re-observes Codex native configuration;
4. model, fixed effort/verbosity, origin metadata, config version and the complete model catalog must still agree;
5. the stored action contains one `model` edit and a native-catalog `modelReference`;
6. apply re-reads `model/list`, resolves exactly one canonical model, then snapshots and performs the versioned `config/batchWrite`;
7. `config/read` must confirm the canonical effective model or the transaction restores the original bytes.

## Why this matters

The optimizer can now close the loop between measurement and reversible native policy without inferring model tiers from names. A candidate that happened to use fewer local tokens is not enough. Efficiency-driven model changes still require exact-policy backend allowance evidence across both the five-hour and weekly windows, while quality-recovery changes remain gated by repeated outcome evidence and accepted-task capacity.

This gives Token Harness a three-stage native control sequence:

- reasoning effort;
- verbosity;
- model.

Only one control is learned and changed at a time.

## Safety invariants

- The planner never writes a project/profile/environment-owned model value.
- A truncated or ambiguous model catalog fails closed.
- The executor refuses a subscription-safe batch that combines `model` with effort or verbosity.
- Provider, auth and service-tier changes remain outside the subscription-safe write set.
- A stored model string is a logical reference, not a canonical value trusted forever.
- Apply-time catalog resolution happens before the config snapshot/write.
- Config version drift is not retried.
- Effective read-back is mandatory.
- Existing transaction rollback restores `config.toml` byte-for-byte.

## Not claimed

This milestone does not claim that a particular Codex model is globally cheaper, faster or better. It does not compare raw Claude and Codex percentages, convert local tokens to subscription quota, purchase/redeem credits, or route work to a paid API.

The learned decision remains specific to the observed harness, project, task class, model pair, reasoning effort, verbosity and recent benchmark evidence.

## Validation gate

The implementation is considered complete only after the final PR head passes the full repository CI on Windows, macOS and Ubuntu: install, typecheck, lint, format check, tests, build, bundle smoke, publishable-package staging and install smoke.

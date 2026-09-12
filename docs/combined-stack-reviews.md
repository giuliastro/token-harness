# Combined-stack reviews

Token Harness treats **individual provider compatibility** and **combined-stack compatibility** as different claims.

A healthy RTK check plus a healthy HarnessTrim check does not prove that the exact RTK + HarnessTrim combination was reviewed together. The guided stack therefore stays `not-recorded` until an exact combined-stack review record exists.

## Capture

Use the read-only command:

```bash
token-harness stack-review --json
```

The capture contains the configured managed providers, their exact observed versions, the exact managed harness set for each provider, and a bounded projection of the existing passive `verify` evidence for those exact provider/harness pairs. It also marks the decision as `pending-manual-decision`.

Passive evidence is reported separately as:

- `observed` when an existing canary or live receipt proves runtime use;
- `not-exercised` when the integration is configured but its passive canary has not seen normal use yet;
- `failed` when passive verification is failed or degraded;
- `unavailable` when no passive runtime witness exists for that exact pair.

The command does not run an active canary, spend a model call, execute a benchmark, install, configure, enable, disable, update, or approve anything. It reuses the same provider inventory as `doctor` and the same passive verification path as `verify`.

## Review rule

A shipped review record matches only when all of these are exact:

- configured provider IDs;
- version for every configured provider;
- configured managed harnesses for every provider.

There are no version ranges or wildcard harnesses in this layer. Provider upgrades, adding/removing a provider, or changing the configured harness set make the previous review stop matching. Duplicate/ambiguous provider detections fail closed.

## Making a decision

A reviewer should test the captured stack together and retain the evidence used for the decision. `stack-review` now makes the first evidence gaps explicit: a `not-exercised` pair should be exercised through normal agent use and checked again, while a failed/degraded pair should be fixed before review. An `unavailable` passive witness requires controlled benchmark or manual evidence instead of an inferred pass.

Even when every exact pair is `observed`, passive provider evidence is not proof that the providers compose safely together. Retain relevant controlled combined-stack benchmark evidence as well; individual provider health alone is insufficient.

Only after the combined result has been deliberately reviewed should an exact registry record be added with either:

- `reviewed` — the captured combination is accepted; or
- `incompatible` — the combination reproduced a conflict or unsafe result.

The shipped registry intentionally starts empty. Token Harness does not auto-promote a combination from `doctor`, `verify`, passive runtime evidence, compatibility rows, or candidate scores.

## Product behavior

The Optimization Stack Manager consumes the registry through exact matching. A missing or stale review remains `not-recorded`, so a multi-provider stack cannot become globally `healthy` merely because every component is healthy in isolation.

This mechanism is evidence plumbing, not a third optimizer mechanism and not a promotion decision. RFC 0027's separate requirement for at least three distinct useful optimization mechanisms remains open.

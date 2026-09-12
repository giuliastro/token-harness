# Combined-stack reviews

Token Harness treats **individual provider compatibility** and **combined-stack compatibility** as different claims.

A healthy RTK check plus a healthy HarnessTrim check does not prove that the exact RTK + HarnessTrim combination was reviewed together. The guided stack therefore stays `not-recorded` until an exact combined-stack review record exists.

## Capture

Use the read-only command:

```bash
token-harness stack-review --json
```

The capture contains only the configured managed providers, their exact observed versions, and the exact managed harness set for each provider. It also marks the decision as `pending-manual-decision`.

The command does not install, configure, enable, disable, update, or approve anything. It delegates inventory to the same provider detection used by `doctor`.

## Review rule

A shipped review record matches only when all of these are exact:

- configured provider IDs;
- version for every configured provider;
- configured managed harnesses for every provider.

There are no version ranges or wildcard harnesses in this layer. Provider upgrades, adding/removing a provider, or changing the configured harness set make the previous review stop matching. Duplicate/ambiguous provider detections fail closed.

## Making a decision

A reviewer should test the captured stack together and retain the evidence used for the decision. At minimum, use the existing verification path and relevant controlled benchmark evidence; individual provider health alone is insufficient.

Only after the combined result has been deliberately reviewed should an exact registry record be added with either:

- `reviewed` — the captured combination is accepted; or
- `incompatible` — the combination reproduced a conflict or unsafe result.

The shipped registry intentionally starts empty. Token Harness does not auto-promote a combination from `doctor`, `verify`, compatibility rows, or candidate scores.

## Product behavior

The Optimization Stack Manager consumes the registry through exact matching. A missing or stale review remains `not-recorded`, so a multi-provider stack cannot become globally `healthy` merely because every component is healthy in isolation.

This mechanism is evidence plumbing, not a third optimizer mechanism and not a promotion decision. RFC 0027's separate requirement for at least three distinct useful optimization mechanisms remains open.

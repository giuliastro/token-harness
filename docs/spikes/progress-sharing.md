# Loading feedback and shareable impact

Date: 2026-09-06. Scope: guided dashboard, building on the clarity interface.

## Reading experience

Five concurrent read stages publish progress through the existing protected activity endpoint.
The endpoint does not start another read. Results are projected into the existing public guide
models, never raw CLI envelopes. Ready savings appear even while allowance or settings reads
remain pending. Pending fields have their own labels, rather than temporarily reporting missing
configuration. A source failure stops that source's spinner and preserves other valid results.
The overview records remain cached; approval and transaction behavior are unchanged.

Section indicators, skeleton lines, named progress chips and operation-specific dialog status
make initial load, refresh, preview and application distinguishable. Waiting text uses elapsed
time only; it does not simulate completion or invent transaction substeps. Reduced-motion users
receive the same textual information without rotating/shimmering animation.

## Impact contract

Each impact story belongs to exactly one provider / measurement class / unit row. The formula
is `(before - after) / before`, over that row's recorded changed outputs. It is not a full-session
ratio. Negative contributions are already included by the existing metrics aggregator. Estimated
measurements retain that qualifier, characters stay characters and provider totals are not added.
Invalid or missing before/after pairs receive no percentage or shareable claim. Growth and zero
net results are explicit; nonzero residuals cannot be rounded into a 100% reduction.

## Sharing and platform choice

X: short draft via the public Web Intent, no SDK or app credentials.
Reddit: title and project link via its submit page; copy the longer summary for a text post.
No subreddit is chosen automatically. Discord: copy a formatted message for the chosen channel;
no bot, webhook or channel credentials. An optional device share sheet appears only when supported.

The preview freezes a sanitized aggregate snapshot, including the reporting window and caveat.
PNG output is generated locally from that same snapshot, not from a screenshot of the dashboard.
The copy and image actions do not upload, publish or attach anything automatically. Clipboard
failure selects the visible text for manual copy. No code, private paths, account names, quota
balances, local IDs or CSRF tokens belong to the share model. Only known provider names, numeric
aggregates, dates and the static public repository link are eligible.

Primary references consulted:
- X Web Intents: https://docs.x.com/x-for-websites/web-intents/overview
- Reddit composer: https://www.reddit.com/submit
- Browser sharing contract: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

## Validation boundary

Local full suite: 1,656 passed, 8 skipped, 0 failed (1,664 total), with four test workers in the
constrained workspace. Typecheck, lint, formatting, build, bundle smoke and installed-package
smoke passed. The unchanged default runner is also used by GitHub CI.

Browser checks use real compiled client assets and synthetic snapshots captured separately from
the actual loopback HTTP handler and guide service. Browser navigation is administratively blocked
in the execution environment, so visual/interaction checks run offline, not against authenticated
accounts. Covered: animated load, ready results during a slow quota read, estimates and scopes,
preview privacy, PNG download, denied clipboard fallback, light/dark and mobile layouts, approval,
read failure recovery, and reduced motion. No post was published during testing.

These tests demonstrate UI and measurement-contract behavior, not a real reduction in an account's
subscription allowance or unchanged coding-task quality. Authenticated A/B evidence stays separate.

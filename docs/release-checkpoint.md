# Release checkpoint — 2026-10-03

Token Harness `0.1.27` simplifies Overview and Results, unifies form controls and replaces the
crowded evidence table with a responsive list of expandable results.

## Changes in this release

- Overview keeps setup status, a direct next action and three compact impact cards. Repeated
  explanations and the permanently unmeasured API-cost card are removed.
- Search, period, source and sort controls share sizing, theme colors and keyboard focus. Evidence
  search includes collapsed provenance; combined filters show a source count and a clear reset.
- Results prioritizes sources with recorded results. Every measurement keeps its class and unit;
  expanded sections show before/after volumes, saved or added output, operation counts and app
  attribution. App-linked views explicitly identify reused optimizer records.
- Routing details separate verification tiers and callback counts from paired savings evidence.
  Quality-blocked claims remain uncredited, and increased usage stays visible.
- Expanded result details survive refresh. Overview/Results tabs support arrow keys, Home and End;
  navigation returns to the page heading.
- On narrow screens, optimizer connections become cards and the appearance selector stays visible.
  Both themes retain readable text, controls and keyboard focus.
- README onboarding and delivery documentation from the previous documentation reconciliation are
  included in this release.

## Release gates

Cross-platform PR CI must pass before creating `release/v0.1.27`. The bridge creates immutable tag
`v0.1.27` and dispatches the exact-tag workflow, which gates publication on tests, real-runtime smoke,
packaging, provenance, npm Trusted Publishing and npm-latest verification.

Visual checks use synthetic observations, separate from actual account or provider measurements.
This UI release adds no new provider compatibility or empirical savings claim. Existing native
Windows runtime and broad-promotion evidence gates remain open.

Release notes and verification scope are in [docs/releases/0.1.27.md](releases/0.1.27.md).

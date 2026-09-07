# Verbosity quality-per-allowance milestone

Date: 2026-09-07
Status: implementation branch
RFC: 0017

## Goal

Make native verbosity a measured optimization rather than a pressure heuristic. Token Harness should change verbosity only when repeated project-local outcomes and exact-policy backend allowance evidence justify it.

## Delivered policy

- model and reasoning effort are fixed while verbosity is learned;
- recognized verbosity levels are `low`, `medium`, and `high`;
- at least three distinct quality-gated paired experiments are required;
- lower verbosity is not actionable from local token savings alone;
- lower verbosity requires complete exact-policy p75 backend quota evidence, non-worse in both five-hour and weekly windows and better in at least one;
- higher verbosity is reserved for repeated quality/retry recovery;
- measured zero accepted-task capacity defers a higher-verbosity recovery change;
- effort and verbosity are never learned in the same optimizer step;
- the previous pressure-only downgrade to low verbosity is removed;
- Codex native planning re-observes model/effort/verbosity and fails closed on drift.

## Safety and measurement boundaries

The implementation reads only the same bounded current-project benchmark evidence already used by the optimizer. It does not execute tasks, install an external observer, read provider credentials, redeem credits, or translate local token counters into subscription quota. Claude/Codex raw percentages remain incomparable across providers.

## Validation target

The merge gate is full repository CI on Windows, macOS and Ubuntu: install, typecheck, lint, format, tests, build, bundle smoke, package staging, and install smoke. The final status of this document should be updated after that gate passes.

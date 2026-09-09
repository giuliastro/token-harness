# Context savings benchmark milestone

## Scope

This milestone adds privacy-bounded context exposure evidence to paired task benchmarks so Savings Engine can evaluate tool deferral and broad context owners without conflating context reduction with subscription quota.

## Delivered

- bounded start/finish context witnesses in benchmark captures and receipts;
- raw and effective MCP exposure counts;
- explicit native/external deferral identity and state;
- additive schema-1 compatibility for old captures/receipts;
- a standalone context comparator that never changes the existing quality/quota verdict;
- CLI benchmark capture wiring for start/finish observations;
- tests for runtime-proven native deferral, external meta-tool reduction, malformed snapshots, and legacy compatibility;
- RFC 0025 defining candidate admission and evidence boundaries.

## Safety boundary

No Headroom, Context Mode or Lazy MCP-style provider is installed or enabled by this milestone. It creates measurement infrastructure only.

A context reduction is reported in its native units. It is not translated into Claude/Codex allowance percentage unless separate authoritative/reported backend quota evidence exists in the same benchmark pair.

## Next milestone

Surface context comparison in benchmark matrix/report output and run controlled candidate experiments. At most one broad context owner may be admitted after quality/retry and marginal-value gates pass.

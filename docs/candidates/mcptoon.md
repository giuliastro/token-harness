# mcptoon candidate integration

mcptoon remains a **candidate**, not a globally registered managed provider. Token Harness has now
reviewed several integration layers independently so progress can be stated precisely without
turning one successful checkpoint into promotion approval.

## Reviewed build

The managed lifecycle and activation witness are pinned to **mcptoon 0.7.10**. Newer versions do not
inherit this evidence automatically.

The reviewed lifecycle already includes exact-version `pipx` installation, inventory, restore and
uninstall, brownfield-safe Claude Code/Codex instruction surfaces, passive verification, and an exact
RFC 0009 compatibility row for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL**.

## Passive activation witness

Candidate attribution by itself is not proof that mcptoon was used. For an optimized mcptoon pair,
`benchmark-start` now records a privacy-bounded boundary from mcptoon's own local usage record and
`benchmark-finish` seals the corresponding activation receipt.

The reviewed 0.7.10 upstream contract stores local usage in `~/.cache/mcptoon/usage.json`. Token
Harness reads that file directly instead of running a tool call, starting an MCP server, or invoking
candidate setup. It also runs only `mcptoon --version` to require the exact reviewed build.

Token Harness deliberately discards the usage record's server and tool identities. The activation
sidecar retains only the exact reviewed version, total-call boundaries, bounded call counts,
success/failure counts, timestamps needed for interval attribution, and the resulting witness state.
No MCP arguments, tool names, server names, raw results, credentials, prompts, or source code are
persisted by this witness.

A completed optimized pair is `verified` only when all of the following are true:

- mcptoon 0.7.10 is observed at both benchmark boundaries;
- the monotonic total-call counter does not move backwards;
- the counter increases during the optimized capture;
- at least one bounded usage record falls inside the benchmark start/finish interval; and
- at least one in-window call succeeded.

No calls, or only failed in-window calls, block activation for that pair. A reset, malformed data,
wrong version, missing boundary, or a counter increase whose bounded call buffer cannot place any
call inside the task interval stays `unknown` rather than being guessed as active.

### Attribution limit

The upstream usage counter is user-local rather than process-lineage scoped. Therefore the witness
proves that the exact reviewed mcptoon build performed successful local tool activity inside the
optimized benchmark window; it does not prove which operating-system process initiated that call.
The standard paired-campaign discipline and combined-stack validation remain required before a
promotion decision.

## What remains before promotion

This activation witness closes a real evidence gap, but it does not put mcptoon in
`PROVIDER_ADAPTERS`. Promotion still requires independent, decision-ready selection evidence from
repeated paired workloads, combined-stack validation with RTK and HarnessTrim, project-maturity
review, and any additional exact harness/platform compatibility required by the intended managed
surface.

Upstream claims or fixture-only results are never copied into user savings. A positive promotion
signal must come from Token Harness's own attributable campaign evidence while preserving quality.

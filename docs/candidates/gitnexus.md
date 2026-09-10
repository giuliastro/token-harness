# GitNexus candidate evaluation

GitNexus is a **candidate-only** repository exploration/code-intelligence component. It is not a
managed provider, is not part of the default optimization stack, and does not count toward the
three-mechanism promotion target.

## Read-only discovery boundary

Token Harness may currently observe GitNexus only through:

- `gitnexus --version`
- `gitnexus --help`
- `gitnexus status --help`

The reviewed GitNexus CLI excludes help/version invocations from its background update checker.
Token Harness must not run `npx`, `gitnexus analyze`, `gitnexus setup`, `gitnexus status`, MCP
servers, hooks, skills installation, package installation, indexing or repository/agent
configuration as part of candidate discovery.

`benchmark-ready` means only that a locally installed CLI reports a semantic version and advertises
`query`, `context`, and machine-readable `status --json` surfaces. It does **not** mean that GitNexus
is installed correctly for an agent, that a repository is indexed, or that GitNexus has been
selected for the managed stack.

## Admission benchmark

GitNexus may be promoted only after a paired, reproducible benchmark against the actual baseline:

`native Claude Code/Codex + active RTK + active HarnessTrim`

The evaluation must include both Claude Code and Codex where supported and measure at least:

1. task/source correctness and regressions;
2. marginal token/context reduction and tool-call reduction;
3. retries, failures and wrong-source/exact-answer errors;
4. indexing/startup latency, disk, memory and refresh cost;
5. overlap or conflict with RTK/HarnessTrim hooks and tool-output ownership;
6. setup/update/uninstall reversibility through Token Harness preview/approval transactions;
7. attributable per-component and combined-stack evidence.

A comparison against a bare agent is useful background evidence but cannot satisfy this gate. Upstream
or third-party benchmark numbers may decide whether GitNexus is worth testing; they must never be
copied into a user's Token Harness savings totals.

## Activation boundary

If the benchmark eventually passes, managed activation must be implemented separately. In
particular, GitNexus `analyze` and `setup` can create indexes and change agent-facing files,
MCP configuration, skills or hooks, so those actions require explicit Token Harness planning,
preview, approval, verification and rollback. Candidate detection must remain side-effect free.

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
configuration as part of candidate discovery. Root help may advertise the `mcp` command; observing
that capability does not execute it.

`benchmark-ready` means only that a locally installed CLI reports a semantic version and advertises
`query`, `context`, and machine-readable `status --json` surfaces. It does **not** mean that GitNexus
is installed correctly for an agent, that a repository is indexed, or that GitNexus has been
selected for the managed stack.

GitNexus now participates in the same bounded candidate projection returned by `token-harness
context` as Headroom and mcptoon. Its `minimumBenchmarkVersion` is reported as `capability-gated`:
readiness is based on the reviewed CLI surfaces above rather than on an invented semantic-version
floor. The projection never includes the executable path or raw command output.

## Transactional MCP checkpoint

A first managed-lifecycle primitive exists **without promoting GitNexus into the provider registry**.
It is intentionally narrower than upstream `gitnexus setup`:

- reviewed version: GitNexus `1.6.12`;
- harness/scope: Claude Code user configuration only (`~/.claude.json`);
- owned entry: `mcpServers.gitnexus` only;
- command: the already-installed reviewed CLI, `gitnexus mcp`; no `npx`, `@latest`, package install,
  index creation, skills or hooks are introduced by the transaction;
- apply reuses the generic `merge-json` executor, so the config is snapshotted, unrelated keys are
  preserved, comments/malformed JSON and brownfield conflicts are refused, and the exact JSON entry
  receives a transaction ownership receipt;
- verify is passive: version/help/status-help plus local config inspection only; it never starts the
  MCP server;
- removal is generated only from the exact ownership receipt and reuses `remove-owned-change`, so a
  user edit to the owned entry blocks automatic deletion and rollback remains snapshot-backed.

A byte-identical GitNexus entry that predates Token Harness is treated as already configured but
**remains user-owned**; Token Harness does not retroactively claim it. Codex is deliberately excluded
from this checkpoint. Its native TOML transaction currently provides whole-file rollback but not a
surgical ownership receipt for one `mcp_servers` entry, so enabling it here would make uninstall less
safe than Claude. That gap must be closed before Codex MCP registration is admitted.

The lifecycle and brownfield-safety tests run in the repository's normal Ubuntu, macOS and Windows
CI matrix even though this checkpoint currently admits only Claude's JSON configuration surface.
This checkpoint closes part of the lifecycle/reversibility work only. It does not provide selection
evidence, real optimized-workload activation evidence, combined-stack validation, project-maturity
admission, or an RFC 0009 compatibility row, and therefore does not make GitNexus promotion-eligible.

## Admission benchmark

GitNexus may be promoted only after a paired, reproducible benchmark against the actual baseline:

`native Claude Code/Codex + active RTK + active HarnessTrim`

Candidate attribution can use the existing benchmark workflow with `--candidate gitnexus`. This
only labels benchmark evidence; it does not activate GitNexus. For new receipts, Token Harness also
records a bounded GitNexus MCP runtime witness from the harness-native MCP inventory at benchmark
start and finish. The activation gate can pass only when the optimized task observes exactly one
GitNexus MCP server as usable at both boundaries. Truncated, ambiguous, absent, unusable, or legacy
missing evidence fails closed. No MCP arguments, tool names, paths, credentials, or config contents
are persisted in that witness.

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

The MCP checkpoint above does not relax the broader activation boundary. GitNexus `analyze` and
`setup` can create indexes and change agent-facing files, MCP configuration, skills or hooks, so any
future management of those surfaces still requires explicit Token Harness planning, preview,
approval, verification and rollback. Candidate detection remains side-effect free.

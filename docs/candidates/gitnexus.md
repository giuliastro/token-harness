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

`benchmark-ready` means only that the **exact reviewed GitNexus `1.6.12` build** is locally installed
and advertises `query`, `context`, and machine-readable `status --json` surfaces. Other semantic
versions, including `1.6.13-rc.1`, return `unsupported-version` after the passive version probe and do
not inherit `1.6.12` benchmark evidence. It still does **not** mean that GitNexus is installed
correctly for an agent, that a repository is indexed, or that GitNexus has been selected for the
managed stack.

GitNexus participates in the same bounded candidate projection returned by `token-harness context`
as Headroom and mcptoon. The projection never includes the executable path or raw command output.

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

The reviewed primitive is now exposed through the candidate CLI lifecycle for the exact recorded
surface. `token-harness apply --candidate gitnexus --harness claude --yes` may register the
**already-installed** reviewed GitNexus CLI only when the exact Claude Code `2.1.269` × GitNexus
`1.6.12` × native-Linux non-WSL compatibility row is admitted. It does not install GitNexus or run
setup/analyze/indexing. `token-harness uninstall --candidate gitnexus --harness claude --yes` removes
only an actively owned `mcpServers.gitnexus` entry and deliberately does not require the GitNexus
binary to remain installed. A later committed removal invalidates older activation ownership, so an
entry recreated by the user cannot be deleted using a stale receipt.

A byte-identical GitNexus entry that predates Token Harness is treated as already configured but
**remains user-owned**; Token Harness does not retroactively claim it. Codex is deliberately excluded
from this checkpoint. Its native TOML transaction currently provides whole-file rollback but not a
surgical ownership receipt for one `mcp_servers` entry, so enabling it here would make uninstall less
safe than Claude. That gap must be closed before Codex MCP registration is admitted.

The lifecycle and brownfield-safety tests run in the repository's normal Ubuntu, macOS and Windows
CI matrix. In addition, a real Ubuntu 24.04 recording now backs one exact RFC 0009 row:
**Claude Code 2.1.269 × GitNexus 1.6.12 × Linux non-WSL**. The recording used an isolated home and
project, exercised the production planner and transaction ownership, refused removal after drift,
verified rollback, and surgically removed only `mcpServers.gitnexus` while preserving unrelated
pre-existing and post-apply user MCP entries/settings. Verification remained `config-only` and did
not start the MCP server. This evidence does not widen to adjacent Claude/GitNexus versions, WSL,
Windows, macOS or Codex.

This checkpoint closes only one exact compatibility/reversibility point. It does not provide
selection evidence, real optimized-workload activation evidence, combined-stack validation, broad
compatibility, or project/license admission, and therefore does not make GitNexus promotion-eligible.

## 2026-09-14 selection and licensing checkpoint

GitNexus is the next candidate to evaluate before Headroom. The reason is mechanism fit, not upstream
benchmark marketing: GitNexus can supply repository graph/code-intelligence queries that may replace
repeated repository exploration, while RTK and HarnessTrim already focus on tool/output efficiency.
Headroom's broad proxy and context-rewriting surface overlaps more directly with existing optimization
ownership and would make marginal attribution and rollback harder.

The exact upstream tuple reviewed for this checkpoint is GitNexus `1.6.12`. Upstream maintenance is
active: stable `1.6.11` was published on 2026-09-04, stable `1.6.12` on 2026-09-12, and
`1.6.13-rc.1` followed on 2026-09-14. The release candidate does not inherit the reviewed `1.6.12`
lifecycle or benchmark-readiness evidence and must not widen the pin automatically.

Licensing is a separate gate from technical maintenance. The exact `1.6.12` npm package and upstream
LICENSE declare **PolyForm Noncommercial 1.0.0**. Token Harness therefore records the narrow Claude
MCP lifecycle as reviewed technical evidence but keeps the project/license promotion gate **blocked**
for generic managed commercial-production use. This is not a determination of any particular user's
legal rights; promotion requires suitable license terms or an appropriate license review for the
intended deployment.

Consequences for Token Harness:

- do not auto-install GitNexus or a package manager;
- do not add GitNexus to `PROVIDER_ADAPTERS`;
- do not convert upstream benchmark claims into Token Harness savings;
- do not widen the lifecycle or benchmark evidence to Codex or arbitrary GitNexus versions/platform assumptions;
- keep setup/analyze/index creation, skills and hooks outside the managed candidate lifecycle;
- keep compatibility/reversibility, selection evidence, runtime activation and combined-stack
  validation as independent gates.

## Admission benchmark

GitNexus may be promoted only after a paired, reproducible benchmark against the actual baseline:

`native Claude Code/Codex + active RTK + active HarnessTrim`

The benchmark workflow supports `--candidate gitnexus`. New campaign starts first pass RFC 0009
admission and then passively confirm exact GitNexus `1.6.12`. The production table currently admits
**only Claude Code 2.1.269 on native Linux (non-WSL)** for GitNexus. Adjacent Claude versions,
Windows, macOS, WSL and Codex remain refused until separately recorded and reviewed. Matrix/report
reads remain passive even outside an admitted row.

The baseline remains a production-stack-only run: witnessing the installed binary version does not
activate GitNexus. New `candidate.json` sidecars persist exact `candidateVersion: 1.6.12`, and only
sidecars carrying that reviewed provenance may contribute GitNexus candidate matrix/campaign evidence.
Legacy or mismatched sidecars remain readable historical data but fail closed for the GitNexus
candidate gate; Token Harness does not rewrite historical benchmark receipts to retrofit provenance.

For new receipts, Token Harness records a bounded GitNexus MCP runtime witness from the harness-native
MCP inventory at benchmark start and finish. A GitNexus baseline is candidate evidence only when that
witness is exactly `absent` at both boundaries; `usable`, `unusable`, `unknown`, truncated/legacy
missing evidence, or a malformed baseline fails closed while leaving the ordinary benchmark receipt
readable. The optimized activation gate is independent and can pass only when exactly one GitNexus
MCP server is usable at both optimized boundaries. No MCP arguments, tool names, paths, credentials,
or config contents are persisted in that witness.

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

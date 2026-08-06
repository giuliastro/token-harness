# Token Harness

Token Harness has one objective: **reduce the tokens consumed by coding agents without hiding
useful information or overstating the result**.

Coding sessions repeatedly send test logs, command output, repository context, MCP schemas,
tool results, and conversation history back to the model. Specialized tools can reduce each of
those sources, but installing them independently creates a second problem: overlapping hooks,
double reduction, incompatible configurations, and savings counted more than once.

Token Harness is the control plane for that optimization stack. It finds the coding agents and
token-saving tools on the machine, selects a compatible owner for each interception point, shows
every proposed change before applying it, verifies whether the integration is genuinely being
used, and reports how many tokens or characters were saved.

The reduction still happens inside specialized providers such as RTK and HarnessTrim. Token
Harness makes those providers safe to combine, observable, reversible, and comparable.

## Optimization ecosystem

The long-term goal is to coordinate token savings across the whole coding-agent pipeline. Only
tools marked **active** are integrated in this release; every other row is a candidate and is
neither installed nor configured by Token Harness.

| Tool | Optimization layer | Token Harness status |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Shell-command rewriting and command-output reduction | **Active — integrated** |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers, harness adapters, skills, pipes, and MCP reduction | **Active — integrated** |
| [Dejavu](https://github.com/Salnika/dejavu) | Emit only the delta when command output repeats | Not active — candidate |
| [Lazy MCP](https://github.com/voicetreelab/lazy-mcp) | Load MCP tool schemas only when needed | Not active — candidate |
| [repowise](https://github.com/repowise-dev/repowise) | Retrieve task-specific repository context | Not active — candidate |
| [LiteLLM](https://github.com/BerriAI/litellm) | Model routing, fallbacks, budgets, and usage telemetry | Not active — candidate |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | Route simpler requests to less expensive models | Not active — candidate |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | Route by task, complexity, tools, and deployment locality | Not active — candidate |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | Compress tool, MCP, file, and RAG payloads | Not active — candidate |
| [Context Mode](https://github.com/mksglu/context-mode) | Keep raw tool results outside model context | Not active — candidate |
| [LLMLingua](https://github.com/microsoft/LLMLingua) | Compress long prompts and context | Not active — candidate |
| [Caveman](https://github.com/JuliusBrussee/caveman) | Reduce visible model-output verbosity | Not active — candidate |

Candidate status means only that the project has identified a useful optimization layer. A tool
becomes active only after its installation, conflicts, rollback behavior, verification, and
metrics attribution have been implemented and tested. Token Harness never installs a candidate
merely because it is present on the machine.

## Quick start

Install the CLI:

```sh
npm install --global token-harness
token-harness --version
```

Then run the complete workflow from the project in which you use your coding agent:

```sh
# 1. Inspect the machine. This does not change agent configuration.
token-harness doctor

# 2. Preview every proposed change.
token-harness plan

# 3. Apply the reviewed plan. This is the first configuration-changing step.
token-harness apply --yes

# 4. Restart the coding agent, then run a normal shell command through it.

# 5. Check configuration, real interception evidence, and savings.
token-harness status
token-harness verify
token-harness metrics --since 7d
```

`doctor` ends with a `NEXT` section. If you are unsure what to do, run the command shown
there.

To try the read-only diagnosis without installing Token Harness globally:

```sh
npx token-harness doctor
```

`npx` may download Token Harness into npm's cache, but it does not install or configure RTK,
HarnessTrim, or a coding agent.

### Managed compatibility rows

Token Harness changes a harness configuration only when a reviewed compatibility row covers the
exact provider version, harness version, platform, and configuration schema. The current
development build deliberately ships no managed rows while the cross-platform fixtures are being
completed. In that state, `doctor` can still detect and report an existing setup, but `plan` and
`apply` refuse an uncovered managed mutation with exit 9; install or configure the provider by
hand until a matching row is released.

## How the components fit together

There are three separate layers. Installing one does not automatically provide the others.

| Layer | Examples | Who installs it? |
| --- | --- | --- |
| Coding agent (harness) | Claude Code, Codex, OpenCode | You, using the agent's official installer |
| Token Harness | `token-harness` | You, from npm or this repository |
| Optimization provider | RTK, HarnessTrim | RTK can be installed by Token Harness; HarnessTrim Claude skills can be installed safely when HarnessTrim 0.0.7 is already available |

Token Harness does not install Claude Code, Codex, or OpenCode. Install and run at least one of
them first so that `token-harness doctor` can detect it.

| Provider | Claude Code | Codex | OpenCode | Installed by Token Harness |
| --- | --- | --- | --- | --- |
| RTK | Configure, verify, and measure | Not managed | Not managed | **Yes**, for the supported Claude Code path |
| HarnessTrim | Claude skills only; no reducer hook or reduce-pipe instruction | Detect, adopt, verify, and measure | Detect, adopt, verify, and measure | **Yes**, when `harnesstrim 0.0.7` is already installed |

"Not managed" does not mean the upstream tool cannot support that agent. It means this release
does not claim ownership of that integration and will not modify it.

The generated compatibility tables, tested version ranges, platform coverage, and known
limitations are in [docs/matrices.md](docs/matrices.md).

## Installing each component

### 1. Install Token Harness

Recommended, from npm:

```sh
npm install --global token-harness
token-harness --help
```

If the command is not found after installation, find npm's global binary directory with:

```sh
npm prefix --global
```

Ensure that directory's executable location is on `PATH`, then open a new terminal.

#### Build and install from source

The repository uses the pnpm version declared in `package.json`.

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
corepack enable
pnpm install
pnpm build
pnpm package
npm install --global ./dist/package
token-harness --version
```

`pnpm build` creates the self-contained CLI at `dist/bundle/token-harness.mjs`.
`pnpm package` creates the installable package under `dist/package`.
If `corepack` is unavailable, install the pinned package manager with
`npm install --global pnpm@10.33.4` instead.

### 2. Install or adopt RTK

When a reviewed compatibility row covers the installed versions, you normally do **not** install RTK yourself:

```sh
token-harness plan --harness claude --provider rtk
```

Once a matching compatibility row exists, if RTK is absent, the plan contains two actions:

1. install RTK through the selected package manager;
2. append one RTK entry to Claude Code's `PreToolUse` hook configuration.

The channel selected by this release is:

| Platform | Channel used by the plan | Required command on `PATH` |
| --- | --- | --- |
| Windows | WinGet package `rtk-ai.rtk` | `winget` |
| macOS | Cargo package `rtk` | `cargo` |
| Linux and WSL | Cargo package `rtk` | `cargo` |

The Cargo path in this release invokes `cargo install rtk`. That channel is declared but has not
been exercised by this project, and upstream documents a crates.io name collision. On macOS,
Linux, and WSL, the safer current route is to install RTK with an upstream-recommended method,
confirm that `rtk gain` works, and let Token Harness adopt and configure the existing binary.

Review the plan's `Network`, `Elevation`, and `Actions` sections before applying it:

```sh
token-harness apply --yes --harness claude --provider rtk
```

If RTK is already installed and configured, Token Harness adopts it instead of reinstalling or
rewriting it. User-owned configuration remains user-owned.

Important boundaries:

- Token Harness writes the reviewed hook itself; it does not run `rtk init`.
- A package install is not reversed by file rollback. `rollback` restores configuration files,
  not installed binaries.
- `uninstall` removes only integration entries written by Token Harness; it deliberately leaves
  the RTK executable installed.
- On native Windows, Claude Code exposes both Bash and PowerShell tool families. The current RTK
  matcher covers Bash only, so `doctor` can correctly report PowerShell as bypassed.

For manual installation or use outside Token Harness's managed surface, follow the
[RTK installation guide](https://github.com/rtk-ai/rtk/blob/master/INSTALL.md), then run:

```sh
rtk --version
rtk gain
token-harness doctor --provider rtk
```

`rtk gain` is an important identity check because another unrelated package also uses the name
`rtk`.

### 3. Install or adopt HarnessTrim

With HarnessTrim `0.0.7` already on `PATH`, `token-harness plan --harness claude` can install its
Claude skills without creating the competing Bash hook or reduce-pipe instruction. The planned
upstream invocation is:

```sh
harnesstrim install claude <project> --apply --no-hook --no-instructions
```

Codex and OpenCode remain adoption-only. Install those integrations with HarnessTrim's own CLI,
first as a dry run and then with its explicit apply flag. Consult the
[HarnessTrim README](https://github.com/giuliastro/HarnessTrim#quick-start) because its adapter
contents, modes, and telemetry differ by coding agent.

After installing it:

```sh
token-harness doctor --provider harnesstrim
token-harness status --provider harnesstrim
token-harness verify --provider harnesstrim
token-harness metrics --provider harnesstrim --since 7d
```

Do not configure RTK and HarnessTrim to reduce the same shell output. In the `safe` profile,
Token Harness gives that exclusive surface to RTK and treats an existing overlap as a hard
conflict instead of guessing an execution order. It never deletes the competing entry for you.

HarnessTrim telemetry is opt-in in some adapters. Without a `.harnesstrim/metrics.jsonl` file,
verification can still inspect configuration, but `metrics` has no HarnessTrim events to import.

From `0.1.0`, HarnessTrim publishes a machine-readable capability declaration: the surfaces it
intercepts per coding agent, the flags that narrow an install, and the paths each install writes.

```sh
harnesstrim capabilities
```

Detection reads that declaration and compares it against the one Token Harness records, so an
upstream change is reported rather than assumed compatible. A disagreement becomes a
`provider-capabilities-drift` warning naming both sides. A build older than the command cannot
answer; Token Harness then falls back to its own recorded declaration and reports nothing, because a
provider that cannot be asked must still be describable.

## The recommended operating workflow

### Step 1: diagnose

```sh
token-harness doctor
```

This answers:

- which supported coding agents are installed;
- which providers are installed and runnable;
- which agent configuration files exist;
- which provider is wired to which agent;
- whether Token Harness owns the integration or merely adopted it;
- whether a version, configuration file, or tool-family matcher needs attention;
- whether the installed provider's own capability declaration still agrees with the one Token
  Harness records.

Common states:

| State | Meaning |
| --- | --- |
| `not found` / `absent` | The executable and usable configuration were not detected |
| `installed` | The provider runs but is not connected to a supported agent |
| `configured` | A relevant hook or plugin entry exists |
| `broken` | Configuration refers to something missing or unreadable |
| `set up by you` | Token Harness adopted existing configuration and will not remove it |
| `set up by this tool` | A committed Token Harness transaction owns the exact entry |

`doctor` is diagnostic. An empty machine is a valid state and exits successfully.

### Step 2: review the plan

```sh
token-harness plan
```

Narrow the operation when useful:

```sh
token-harness plan --harness claude
token-harness plan --provider rtk
token-harness plan --project /path/to/project
```

Read these sections before proceeding:

- `Capability ownership`: which provider is allowed to transform each surface;
- `Excluded`: detected providers intentionally left out;
- `Actions`: every package operation and file change;
- `Network`: destinations contacted by later mutation;
- `Elevation`: whether administrator/root access would be required;
- `Backups`: how many files will be snapshotted.

`plan` does not modify agent or project configuration. It may persist the serialized plan in
Token Harness's private state directory so the exact reviewed artifact can be applied later.

If the plan prints an ID, apply that exact plan with:

```sh
token-harness apply --plan <plan-id> --yes
```

The stored plan is rejected before any action runs if the project, versions, ownership, or file
preconditions changed after review.

### Step 3: apply

```sh
token-harness apply --yes
```

Without `--yes`, `apply` shows what it would do and exits with code 8. Every affected file is
snapshotted before mutation, including the prior absence of a newly created file. A failure
triggers automatic restoration and the result states whether that restoration was verified.

After a successful apply, restart the coding agent so it reloads its hooks or plugins.

### Step 4: create real traffic

Passive verification needs evidence from an operation that actually passed through the provider.
Open the configured coding agent and ask it to run a normal shell command such as `git status` or
a test command. Then return to the terminal.

### Step 5: verify configuration and execution

Use both commands; they answer different questions:

```sh
token-harness status
token-harness verify
```

`status` compares the live environment with committed receipts. It finds drift, changed versions,
and competing entries on exclusive surfaces.

`verify` checks the strongest evidence the integration declares:

| Tier | What it proves |
| --- | --- |
| `presence` | The executable resolves and reports a version |
| `config-only` | The expected configuration entry exists |
| `canary` | Provider records show a real operation crossed the interception point |

`config-only` is not proof that the hook ran. It is the honest ceiling for integrations whose
runtime state cannot be observed externally.

`not-exercised` means no attributable operation has been observed yet. It is neither success nor
failure: run a command through the agent and check again.

### Step 6: inspect savings

```sh
token-harness metrics
token-harness metrics --since 24h
token-harness metrics --since 2026-07-01 --until 2026-08-01
token-harness metrics --provider rtk --since 7d
```

The default window is seven days. Durations such as `12h`, `7d`, and `2w`, plus ISO dates, are
accepted. Date boundaries are midnight UTC.

The report keeps measurement types and units separate:

| Report line | Interpretation |
| --- | --- |
| `Exact local` | Before and after token counts were observed for the same operation |
| `Estimated local` | The payload changed, but the reported unit or tokenizer is an estimate |
| `Counterfactual` | A dry run measured what could have changed; it is not realized saving |
| `End-to-end billed` | Comparable billed sessions were measured; otherwise it says `no A/B run` |
| `Coverage` | Share of relevant operations that were actually changed |
| `Bypassed` | Operations observed but passed through unchanged or outside coverage |

Token counts are never added to character counts, and estimated or counterfactual values are never
silently merged into an exact total.

The report covers one project: the one `--project` names, or the current directory. An operation a
provider recorded without a directory belongs to no project and is excluded, with a count reported
so the difference is reconcilable. When no project identity can be established the report says so
rather than presenting every project's events as one project's figures.

## Undoing changes

Choose the command based on what you want to undo:

```sh
# Remove only exact integration entries owned by Token Harness.
token-harness uninstall --yes

# Restore all files from the most recent committed transaction snapshot.
token-harness rollback --yes
```

`uninstall` is usually the safer choice after subsequent manual edits: it is surgical and refuses
to remove an owned entry if its content no longer matches what Token Harness wrote.

`rollback` restores whole files to their pre-transaction bytes. Changes made to those files after
the transaction are therefore also reverted. It does not restore or remove provider packages.

Neither command removes user-owned RTK or HarnessTrim configuration.

## Command reference

| Command | Purpose | Changes agent/project configuration? |
| --- | --- | --- |
| `doctor` | Detect agents, providers, ownership, and problems | No |
| `plan` | Resolve ownership and preview exact actions | No; stores the plan in private state |
| `apply` | Apply a plan transactionally | Yes, only with `--yes` |
| `status` | Detect drift and competing hooks | No |
| `verify` | Check the declared verification tier | No |
| `metrics` | Import provider records and report savings | No; updates only Token Harness state |
| `update` | Query channels and update installed providers | Yes, only with `--yes` |
| `rollback` | Restore files from the latest committed transaction | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |

Every command supports `--help`. Common filters are:

```text
--harness claude|codex|opencode
--provider rtk|harnesstrim
--project <directory>
--json
```

## Automation and JSON output

Use `--json` in scripts:

```sh
token-harness doctor --json
token-harness verify --json
token-harness metrics --since 7d --json
```

stdout contains exactly one JSON document with this top-level contract:

```json
{
  "schemaVersion": 1,
  "command": "verify",
  "toolVersion": "0.1.0",
  "status": "ok",
  "exitCode": 0,
  "data": {},
  "diagnostics": []
}
```

Important exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | Completed with nothing actionable |
| 2 | Invalid command or argument |
| 3 | A read-only check found an actionable problem |
| 4 | A capability conflict blocks the plan |
| 5 | The environment drifted from the stored plan or journal |
| 6 | Mutation failed and rollback was verified |
| 7 | Mutation failed and state was not fully restored; inspect the named paths |
| 8 | The command needs explicit confirmation (`--yes`) |
| 9 | Unsupported or unverifiable environment |

Do not treat every non-zero code as the same failure. In particular, code 8 is the expected result
of previewing a mutating command without approval.

## State, backups, and privacy

Token Harness stores plans, journals, backups, receipts, import cursors, and normalized metrics
outside the repository:

| Platform | Default state root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\TokenHarness` |
| macOS | `~/Library/Application Support/TokenHarness` |
| Linux and WSL | `${XDG_STATE_HOME:-~/.local/state}/token-harness` |

Normalized metrics do not contain raw command text, tool output, source code, prompts, credentials,
or raw file paths. Provider records are read in place; Token Harness imports only normalized event
data.

## Troubleshooting

### `token-harness` is not found

Confirm Node and the global npm installation:

```sh
node --version
npm list --global token-harness
npm prefix --global
```

Node must be at least 22.13.0. Add npm's global executable directory to `PATH`, then reopen the
terminal.

### `plan` says there is nothing to do

Run `token-harness doctor`. The usual causes are:

- no supported coding agent was detected;
- the requested provider does not claim that coding agent in this release;
- an existing user-managed integration already satisfies the target state;
- the safe profile excluded an overlapping provider.

RTK is managed only for Claude Code in 0.1.0. A Codex-only or OpenCode-only machine therefore does
not produce an RTK installation action.

### The plan is blocked by `exclusive-scope-contested`

RTK and HarnessTrim both claim the same reducing surface. Token Harness will not choose an order or
overwrite either configuration. Remove or disable one integration using the tool that owns it, then
run `doctor` and `plan` again.

### `verify` reports `not-exercised`

Restart the coding agent, ask it to run a shell command through the configured tool family, then
run `token-harness verify` again. For a `config-only` integration, no stronger external receipt may
exist; the output states that limitation explicitly.

### `metrics` shows no data

Check all of the following:

- the provider has processed at least one operation in the requested time window;
- `rtk gain` works for RTK;
- HarnessTrim telemetry is enabled and `.harnesstrim/metrics.jsonl` exists for the project;
- `--project` points to the project whose records you expect;
- `--since` is not excluding older events.

An empty metrics report exits 0 because it is a valid observation, not a command failure.

### `doctor` or `status` reports `provider-capabilities-drift`

The installed provider's own capability declaration no longer agrees with the one Token Harness
records. The warning names both sides: what the recorded declaration claims, and what the installed
build reported. Nothing is modified, and the recorded declaration still drives planning.

Three disagreements are reported:

- a coding agent that Token Harness records a capability on is missing from the build's declaration;
- the reduction surface Token Harness records is absent from the surfaces the build reports;
- the build no longer covers a reviewed write-set path, or declares a path outside the reviewed
  containment boundary.

The last one matters most before a delegated install. Rollback restores the reviewed boundary, so a
path outside it would survive a rollback. Re-review the write set at the installed version, or hold
at the reviewed one.

### A newer provider or agent version is reported

The tested ranges record versions actually exercised by this project. A newer version is reported
and handled conservatively rather than assumed compatible. Check [docs/matrices.md](docs/matrices.md)
and the upstream release notes before applying configuration changes.

## Development

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke
pnpm package
pnpm smoke:install
```

Tests use temporary homes and fake process runners; they do not install third-party tools.
`pnpm smoke` runs the bundle from outside the workspace, and `pnpm smoke:install` validates the
packed npm artifact.

Before changing architecture or public behavior, read [PLAN.md](PLAN.md) and the accepted RFCs in
[docs/rfcs](docs/rfcs). The CLI and JSON contract is defined by
[RFC 0006](docs/rfcs/0006-cli-contract.md).

## License

Token Harness is licensed under the [Apache License 2.0](LICENSE). RTK and HarnessTrim are
independent upstream projects distributed under their own licenses.

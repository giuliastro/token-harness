# Token Harness

**Make Claude Code and Codex easier to understand and use efficiently.**

Token Harness checks your coding agents, shows subscription allowance when it can be
observed reliably, reduces avoidable context overhead, and recommends useful actions.
It runs locally and never presents local token estimates as subscription quota.

## Open it. Approve setup. Keep coding.

You need [Node.js 22.13 or newer](https://nodejs.org/) and an installed, signed-in
Claude Code or Codex. Install Token Harness, then open it:

```sh
npm install --global token-harness@latest
token-harness
```

The browser is now the primary interface. **Set up automatically** checks both agents and
prepares the supported integration changes. It describes each change in plain language.
Choose **Approve and apply** to apply the reviewed configuration with backups and verification.
There are no plan IDs to copy and no daily command sequence to remember.

Already configured? The app shows your existing integrations without replacing them.
An absent provider or an unreviewed version combination is explained rather than installed
or forced silently. Automatic setup covers the reviewed integration paths, not every possible
provider/version. Token Harness does not install Claude Code or Codex or log you in.

### Daily use

Continue launching `claude` or `codex` as usual. Supported output integrations operate in the
agent, not in the dashboard. You can close the page and its terminal without disabling those
integrations. Open `token-harness` whenever you want to see results; the visible dashboard
imports available provider records and refreshes its readings automatically.

**Recorded savings** shows retained history across locally recorded projects, with date bounds,
provider, measurement class, units, changed-output counts, and before/after values. It does not
add incompatible provider figures together. Negative results remain visible. No telemetry is
shown as **not measured**, never a reassuring zero or an invented subscription saving.
Some provider records may predate Token Harness; locally stored records are not guaranteed
complete lifetime history. RTK history is imported directly. HarnessTrim project-local records
must have been imported from their project, or exposed through a configured known metrics path;
the app does not crawl your disk looking for private projects.

For a terminal-only summary, the one command is:

```sh
token-harness savings
```

Optional windows are `--since 7d` and `--since 30d`. The advanced `metrics` command remains
project-scoped; opening the app from its installation folder does not change the savings scope.

### The rules are visible

**What is being optimized?** explains each configured rule: what it does, why it is used,
its mode, and the evidence available. Automatic integrations, persistent preferences,
observations and features that are not enabled are explicitly distinguished.

RTK's supported command integration can reduce output automatically. HarnessTrim can use
adapters or skills/instructions, depending on the installation; skills-only is not a transparent
hook, and the agent must actually use the reducer. Configured never means every command was
intercepted. Provider telemetry and its exact/estimated classification remain separate evidence.

**Optional: match reasoning to your work** lets you choose the agent and the type of work
without learning CLI flags. It previews the actual supported effort/verbosity change, then
applies only after approval. **This is a persistent preference for future sessions, not an
automatic per-task switch.** It does not switch models, billing, login, or hook trust. The
baseline automatic setup never guesses a task or quietly lowers reasoning.

**Check integrations** performs the existing integration checks from the UI.
**Undo last change**, available after an application in that dashboard session, previews a
whole-file backup restoration. It refuses to undo a newer unrelated transaction. It restores
only the last successful agent transaction; manual edits to those same files after that
transaction would also be restored, as the confirmation explains.

### Run the current source

From an existing clone, after installing its dependencies, one command builds and opens the app:

```sh
npm start
```

For a fresh clone:

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
npx --yes pnpm@10.33.4 install --frozen-lockfile
npm start
```

This uses the clone, not an older global installation. An unmerged branch or unpublished main
change is not automatically available through `token-harness@latest`.

### Advanced and AI-assisted use

An AI may use the existing JSON CLI to inspect, plan and apply an explicitly approved change.
That is optional: another AI subscription is not required to operate the app. No persistent
agent, background model calls or task classifier runs behind your back.

The older automation contracts remain available: `setup`, `optimize`, `plan`, `apply`,
`verify`, `metrics`, `rollback`, and their JSON reports. `ui --json` preserves its existing
schema-1 report; `ui --read-only` opens the legacy read-only dashboard. `ui --no-open` starts
the guided app without launching a browser. Stop either local server with Ctrl+C.

## What normal output looks like

A healthy final check is intentionally short:

```text
TOKEN HARNESS - READY

WHAT WORKS
  Codex: configured (0.146.0)
  HarnessTrim: active on Codex

CHANGES
  Nothing changed.

NEXT STEP
  Use your coding agent normally; configured optimizers run automatically.
```

A newer-than-tested combination is not presented as if the whole setup were broken:

```text
TOKEN HARNESS - READY WITH LIMITATIONS

WHAT WORKS
  Claude Code: configured
  RTK: active on Claude Code

NEXT STEP
  token-harness verify
  You can keep working; verify the active integrations when convenient.
```

Need the evidence behind a summary? Add `--verbose`:

```sh
token-harness doctor --verbose
```

Need stable machine-readable output for automation? Add `--json`:

```sh
token-harness doctor --json
token-harness ui --json
```

`--json` keeps the complete schema-1 result and diagnostics; it is not shortened.

## Two entry points to remember

`token-harness` opens the application. `token-harness savings` prints recorded results.
The advanced commands below are implementation tools, not a required user workflow.

## Safety and privacy

Token Harness is conservative by design:

- normal read-only commands do not change coding-agent or project configuration;
- `setup --yes`, `apply --yes`, `update --yes`, `rollback --yes`, and
  `uninstall --yes` are the explicit CLI configuration-changing forms; the guided UI uses
  a reviewed preview and explicit **Approve and apply** instead;
- plans are checked again immediately before they are applied;
- existing files are backed up before a managed write;
- only exact Token Harness-owned entries are removed by `uninstall`;
- newer or untested combinations are reported, not guessed;
- an available provider update outside reviewed compatibility is kept out rather than
  forced, and the installed working version stays in place;
- the guided app binds only to 127.0.0.1 and protects its fixed local controls with exact
  Host/Origin checks, a per-process anti-forgery token and single-use approval tickets;
- the legacy read-only dashboard and external status seam remain read-only;
- source code, prompts, command contents, credentials, and cookies are not sent to a
  Token Harness service.

Plans, receipts, metrics, and backups stay in the local Token Harness state directory.
See [RFC 0013](docs/rfcs/0013-guided-local-experience.md) for the local browser trust boundary,
[RFC 0004](docs/rfcs/0004-safety-and-installation.md) for the execution model and
[RFC 0006](docs/rfcs/0006-cli-contract.md) for CLI/JSON guarantees.

## Supported optimizations

Token Harness can detect and measure several independent local tools:

| Provider | Purpose | Management |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Shell-command rewriting and output reduction | Managed only for reviewed combinations |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers and harness adapters | Managed only for reviewed combinations |
| [cclimits](https://github.com/cruzanstx/cclimits) | Optional live/local quota companion | Read-only; never installed automatically |
| [ccusage](https://github.com/ccusage/ccusage) | Local usage history | Read-only; never installed automatically |

A provider you installed yourself remains yours. Token Harness can adopt observable
configuration without claiming ownership of the executable.

Exact reviewed provider/harness/platform/version combinations are generated in
[docs/matrices.md](docs/matrices.md). A combination outside that table can still be
detected and inspected, but Token Harness will not mutate it.

## Advanced commands

Most people do not need this section. Run `token-harness <command> --help` for details.

| Command | Purpose | Changes agent/project config? |
| --- | --- | --- |
| `doctor` | Detect harnesses, providers, versions, and problems | No |
| `budget` | Read authoritative/reported allowance windows | No |
| `context` | Inspect model settings, instructions, and MCP exposure | No |
| `mcp` | Focus on MCP server/tool health | No |
| `history` | Summarize local usage through an installed ccusage | No |
| `plan` | Prepare exact supported changes | No; stores local plan state |
| `apply` | Apply a reviewed stored plan | Yes, only with `--yes` |
| `verify` | Check the declared integration tier | No |
| `metrics` | Report attributable reducer savings | No |
| `status` | Report pipelines, drift, and importer modes | No |
| `update` | Check/update installed providers; unreviewed targets stay installed | Yes, only with `--yes` |
| `rollback` | Restore the latest transaction snapshot | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |
| `schedule` | Compare Claude Code and Codex using available evidence | No |
| `handoff` | Build a bounded cross-harness handoff | No |
| `benchmark*`, `transfer*` | Capture and compare empirical evidence | Local state only |

## Applying native recommendations

`optimize` remains read-only. Review a plan before applying a supported native change:

```sh
token-harness plan --harness claude --native-policy --task mechanical --profile economy
token-harness apply --plan <printed-plan-id> --yes
```

`apply --plan <id>` restores the reviewed harness/provider selection automatically; you
should not have to repeat `--harness`, `--provider`, `--native-policy`, `--task` or `--profile`.
Run it from the same project as `plan`. Conflicting explicit selectors are rejected, and
actual version, ownership and configuration changes still invalidate the plan. Existing
schema-1 plans remain usable; only their approved actions can execute.

The first Claude path supports the **persisted user effort preference** on the reviewed
Claude Code 2.1.261 build. It does not change model, authentication, hooks, endpoint or billing.
`max` is never persisted. Project/local/ancestor settings, custom configuration roots and
known environment/thinking overrides block the change rather than being overwritten. The
preference affects future sessions unless overridden: reopen Claude and check `/effort`.
This is not evidence of a running session's effective effort or a guaranteed quota saving.

For Codex, the same plan/apply flow manages the existing reviewed reasoning-effort and
verbosity fields through native `config/batchWrite`; project/profile overrides remain yours.
`rollback --yes` restores the complete pre-change files. `uninstall --yes` removes only owned
changes and restores a prior Claude effort preference without undoing unrelated later edits.

## Troubleshooting

### Claude allowance is unavailable

The dashboard now explains whether the optional companion is missing, lacks the safe CLI
flags, cannot find Python, has no usable Claude session, reports an expired session, or returns
an unsupported source. It does not expose credentials, raw companion errors or private paths.

As observed on **September 5, 2026**, npm `cclimits@1.7.0` includes the merged Claude
zero-configuration support and the read-only flags. The latest GitHub Release listing is older
and is not evidence of what npm ships. To check the same path Token Harness uses:

```sh
npm list --global cclimits
cclimits --claude --json --no-cache-write --no-stale-fallback
token-harness budget --harness claude --verbose
```

An explicit optional installation/update is `npm install --global cclimits@1.7.0`.
Token Harness does not install it automatically or retry without its read-only flags.
A fresh local Claude cache is shown as **cached**, never promoted to live quota pacing.
A missing observation is not zero remaining allowance. Never paste credentials to debug it.

### Codex is configured but its hook does not run

`token-harness verify --harness codex --verbose` now reads native `hooks/list` where the
installed app-server exposes it. Disabled, untrusted and modified hooks are distinguished from
an unavailable observation. Trust must still be granted explicitly in Codex. Enabled/trusted
metadata does not prove interception, reduction, or task quality; the integration remains
`config-only` until attributable runtime evidence exists.

### `token-harness` is not found

Check that Node is new enough and the package is installed:

```sh
node --version
npm list --global token-harness
```

Node must be at least 22.13. Reopen the terminal after installation if needed.

### Setup needs attention

Run the single command it prints. For technical evidence:

```sh
token-harness doctor --verbose
```

Do not force an unsupported plan. Open an issue with the redacted `--json` result if
you believe the combination should be supported.

### `update` finds a newer version but keeps the installed one

That is normally a safety decision, not a failed installation. Token Harness found a
newer provider release but does not yet have reviewed compatibility evidence for the
active provider × harness × platform combination. Keep using the installed version; no
manual upgrade is required.

### Verification says `not-exercised`

Restart the coding agent, use it for one normal command, and run:

```sh
token-harness verify
```

No observed operation is different from a failed integration, so Token Harness reports
the two states separately.

## Updating or undoing

Update the CLI:

```sh
npm install --global token-harness@latest
token-harness setup
```

Remove only Token Harness-owned integration entries:

```sh
token-harness uninstall --yes
```

Restore complete files from the latest committed transaction snapshot:

```sh
token-harness rollback --yes
```

`rollback` is whole-file time travel, so it can also revert later manual edits to those
files. Prefer `uninstall` when you only want to remove Token Harness-owned entries.

## Develop from source

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
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

Read [PLAN.md](PLAN.md) and the accepted [RFCs](docs/rfcs) before changing public
behavior or architecture.

## License

[Apache License 2.0](LICENSE). Referenced provider tools are independent projects with
their own licenses.

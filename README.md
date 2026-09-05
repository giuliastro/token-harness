# Token Harness

**Make Claude Code and Codex easier to understand and use efficiently.**

Token Harness checks your coding agents, shows subscription allowance when it can be
observed reliably, reduces avoidable context overhead, and recommends useful actions.
It runs locally and never presents local token estimates as subscription quota.

## The easy path

You need [Node.js 22.13 or newer](https://nodejs.org/) and at least one signed-in coding
agent such as Claude Code or Codex.

Open a terminal and paste:

```sh
npm install --global token-harness@latest
token-harness setup
```

That is the whole first-time check. `setup` tells you:

- which coding agents it found;
- which optimizers are already active;
- whether the current setup works;
- what it changed, if anything;
- exactly one next step.

The first run does not change Claude Code, Codex, or project configuration. If Token
Harness finds a supported improvement, it shows the safe plan and may suggest:

```sh
token-harness setup --yes
```

`--yes` is always explicit. The change is backed up, applied transactionally, and
verified. Unsupported combinations are left untouched.

## Open the dashboard

After setup, run:

```sh
token-harness ui
```

The dashboard opens in your browser and answers three questions in this order:

1. **Can I work normally right now?**
2. **What is actually active and useful?**
3. **Is there one action worth taking?**

It shows active/relevant coding agents first, their optimization providers, observable
allowance windows, and task guidance. Tools that are absent do not get large cards;
secondary detected tools are kept out of the main path.

The page is served only on `127.0.0.1`: no Electron app, account, or cloud service.

### What happens after the dashboard?

Usually: **nothing else. You are done.**

Token Harness is not a launcher and it does not need to stay between you and your coding
agent. Continue exactly as you normally would:

```sh
claude
codex
opencode
```

Use whichever of those you already use. RTK, HarnessTrim, or another configured provider
runs automatically through that coding agent's integration. You do **not** need a special
`token-harness run` command.

You can close the dashboard whenever you want. Use `Ctrl+C` in the terminal to stop its
local web server. Closing it does not disable configured optimizers.

Open it again later with `token-harness ui` when you want a status check. If you do not
want it to open a browser:

```sh
token-harness ui --no-open
```

## Daily use

There is no mandatory command loop. These are tools you use when they answer a question:

| When you want to know... | Run |
| --- | --- |
| Is everything still connected? | `token-harness ui` |
| What should I do before a demanding task? | `token-harness optimize --task hard --profile quality` |
| Is an integration actually working? | `token-harness verify` |
| How much reducer saving has been measured? | `token-harness metrics --since 7d` |
| Are safer provider updates available? | `token-harness update` |

If a command finishes with **no action required**, stop there and use your coding agent
normally. Token Harness should not send you around a `ui → optimize → ui` loop.

## Ask your AI to install Token Harness

You can give this prompt to Claude Code or Codex:

```text
Install the latest stable Token Harness from npm on this computer, then run
`token-harness setup`. Do not install or replace Claude Code, Codex, or any
optimization provider unless Token Harness's supported plan explicitly requires it.

Explain the setup result in plain language: what was detected, what already works,
what would change, and the single next step. Do not expose credentials, cookies,
tokens, raw home paths, or private project contents. If setup proposes a supported
configuration change, show me the short plan and ask before running
`token-harness setup --yes`. After an approved change, verify it and open
`token-harness ui` once. Then tell me clearly that setup is complete and that I should
continue using my normal coding-agent command. Do not invent additional Token Harness
steps when no action is required.
```

The AI should ask before the `--yes` step because that is the point where coding-agent
configuration may change.

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

## Three commands to remember

```sh
token-harness setup
token-harness ui
token-harness optimize
```

| Command | Answer |
| --- | --- |
| `setup` | Is Token Harness ready, and what is my one next step? |
| `ui` | What is active, how much allowance is visible, and do I need to do anything? |
| `optimize` | What is the best evidence-based action for the task I am starting? |

For example:

```sh
token-harness optimize --task hard --profile quality
token-harness optimize --task mechanical --profile economy
```

## Safety and privacy

Token Harness is conservative by design:

- normal read-only commands do not change coding-agent or project configuration;
- `setup --yes`, `apply --yes`, `update --yes`, `rollback --yes`, and
  `uninstall --yes` are the explicit configuration-changing forms;
- plans are checked again immediately before they are applied;
- existing files are backed up before a managed write;
- only exact Token Harness-owned entries are removed by `uninstall`;
- newer or untested combinations are reported, not guessed;
- an available provider update outside reviewed compatibility is kept out rather than
  forced, and the installed working version stays in place;
- the dashboard binds only to the local loopback address and provides no mutation API;
- source code, prompts, command contents, credentials, and cookies are not sent to a
  Token Harness service.

Plans, receipts, metrics, and backups stay in the local Token Harness state directory.
See [RFC 0004](docs/rfcs/0004-safety-and-installation.md) for the execution model and
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

## Troubleshooting

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

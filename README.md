# Token Harness

**Make your Claude Code and Codex allowance go further. Measure what actually helps.**

[![npm version](https://img.shields.io/npm/v/token-harness)](https://www.npmjs.com/package/token-harness)
[![CI](https://github.com/giuliastro/token-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/giuliastro/token-harness/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Coding agents spend context on long command output, repeated information and tool definitions.
Token Harness helps you reduce that overhead, connect compatible optimizers and see their measured
impact in one local dashboard. Keep working in Claude Code or Codex as usual.

For subscription users, the goal is **more accepted coding work within your included allowance**.
For API users, it is **less avoidable token usage with costs reported only when billing evidence is
available**. Token reduction, subscription quota and billed cost are different measurements; Token
Harness keeps them separate.

## Install and start

You need **Node.js 22.13+** and an installed, signed-in **Claude Code or Codex**.
Run these commands in your terminal, including PowerShell on Windows:

```sh
npm install --global token-harness@latest
token-harness
```

A local browser dashboard opens. No Token Harness account or API key is required.
Your coding agent keeps its own authentication. Windows, macOS, Linux and WSL have explicit
compatibility checks; individual integrations may support a narrower set of versions/platforms.

Prefer to try it before installing globally?

```sh
npx --yes token-harness@latest
```

Updates for an `npx` launch use a new `npx` launch; automatic application updates require a verified
global npm installation.

## Your first five minutes

1. **Open Overview.** Token Harness detects your agents, installed optimizers and integration health.
2. **Review optimizer setup.** Start with RTK + HarnessTrim where the exact combination is supported.
   Each optimizer has its setup, verification and removal controls together.
3. **Preview and apply.** Check the proposed changes, then approve. Opening the dashboard alone does
   not change agent configuration.
4. **Authorize native hooks once.** In Codex, use `/hooks` to enable and trust the installed hooks.
   In Claude Code, ensure hooks are enabled and start a fresh session after changing them.
5. **Use your agent normally.** Return to Results to inspect observed evidence. “Configured” means
   setup exists; “runtime observed” means a qualifying callback or operation was actually recorded.

You do not need to keep the dashboard open for installed native hooks to run. Evidence appears after
qualifying activity; an idle installation cannot prove execution. Use the action beside an affected
agent or optimizer when a version or prerequisite needs attention.

## What you get

| Feature | How it helps |
| --- | --- |
| **One optimization dashboard** | Inspect agents, optimizers, health and updates together. |
| **Less noisy tool output** | Connect RTK and HarnessTrim on reviewed integration rows. |
| **Automatic prompt guidance** | Opt into native hooks that supply a bounded delegation policy on each prompt. |
| **Allowance-aware advice** | Inspect five-hour/weekly windows and native model/effort recommendations when evidence is available. |
| **Measured results** | Filter, sort and expand evidence by agent, optimizer or routing mechanism. |
| **Safe maintenance** | Preview changes, retain backups, verify updates and remove owned configuration. |

Automatic routing needs no skill invocation or prompt prefix after setup and native authorization.
The root model stays in place; the agent may delegate an eligible bounded subtask to a cheaper native
model and review the result. A callback proves the hook ran, not that a particular child model was
used or that allowance was saved. See [routing details](docs/rfcs/0030-automatic-native-prompt-routing.md).

## Savings and statistics: what is measured today?

**There is no verified universal “save X%” claim.** Your results depend on the workload, installed
stack and available observations. The dashboard reports evidence from your own machine rather than
turning upstream marketing numbers into your savings.

| Measurement | What you can trust |
| --- | --- |
| **Output reduction** | Attributable provider receipts, with tokens/characters and exact/estimated classes labelled separately. This is not a subscription saving percentage. |
| **Subscription allowance** | Same-task baseline/optimized comparisons using authoritative five-hour and weekly observations, without crossing resets. Quality and retries are checked separately. |
| **Routing benefit** | Paired runs with routing disabled/enabled, genuine callback evidence and both quality gates passed. No qualifying pair means **Not measured yet**. |
| **API cost** | Attributable billed tokens and a verified model-price basis are required. Without them, cost stays **Not measured yet**. |
| **Quality** | Acceptance, retries and regressions remain visible. A regression blocks a positive saving claim. |

The reported mcptoon evaluation completed **8 paired tasks** and **16/16 quality passes**:
4 pairs were equivalent, 2 favoured the optimized variant and 2 favoured the baseline. It produced
**no consistent subscription saving signal**, and no successful mcptoon activity was observed inside
the optimized task windows. Those differences cannot be attributed to mcptoon. It remains optional
and experimental, rather than a proven third savings mechanism.
[Evaluation record](docs/development-status.md#historical-development-log).

The current **0.1.26** release passed CI on **Windows, macOS and Linux**, plus exact-artifact
publication/install checks. Real Windows combined-stack evidence and broader promotion gates remain
open. [Release evidence and roadmap status](docs/plan-status.md).

For a terminal summary of locally recorded evidence:

```sh
token-harness savings --since 7d
```

No provider totals are silently combined across incompatible units. Missing evidence is unknown,
not zero. Positive savings claims require attributable paired measurements with quality gates.

## Available optimizers

| Component | Purpose | Current role |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Reduce shell/tool output | Baseline integration on reviewed rows. |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic output/context reduction | Baseline integration on reviewed rows. |
| mcptoon | Compact MCP discovery/manifests | Optional; install through an existing pipx or uv. Missing prerequisites show installation options. |
| GitNexus | Repository graph and MCP context | Optional reviewed integration; package/index preparation and license review are user responsibilities. |
| Headroom | MCP context compression/retrieval | Optional configuration-only integration for an already-installed reviewed package. |
| [cclimits](https://github.com/cruzanstx/cclimits) / [ccusage](https://github.com/ccusage/ccusage) | Allowance / usage observations | Read-only evidence sources, rather than optimizers. Usage history is not remaining quota. |

Current source-reviewed package targets are **RTK 0.51.0** and **HarnessTrim 0.3.1**. Package update
policy and exact agent-configuration compatibility are separate: a newer installed package does not
automatically admit new config writes or a combined-stack review. RTK + HarnessTrim still need real
combined workload evidence before broader promotion. Optional integrations do not count as proven
savings mechanisms merely because they are installed.

See [version policy](docs/provider-version-compatibility.md),
[compatibility and verification tiers](docs/matrices.md), and
[candidate promotion gates](docs/candidates/promotion-readiness.md).

## Update, disconnect or undo

The dashboard checks for updates on opening. When an update is available, review its exact version
and approve installation. It re-checks health automatically afterward. A supported application
update offers **Restart and re-check** to load the new version; if replacement startup fails, the
current dashboard stays available.

To update manually:

```sh
npm install --global token-harness@latest
token-harness
```

To disconnect an optimizer, use **Remove Token Harness-managed configuration** beside that optimizer.
It removes only entries Token Harness owns. The CLI equivalent for owned integrations is:

```sh
token-harness uninstall --yes
```

To restore the latest complete configuration snapshot:

```sh
token-harness rollback --yes
```

Rollback restores whole files and can revert later manual edits. Prefer owned removal when you only
want to disconnect Token Harness integrations. Provider package management and uninstall scope are
shown in the reviewed plan.

## Local by design

The dashboard binds to `127.0.0.1`. Plans, receipts, metrics and backups stay in local state.
Token Harness does not send your source code, prompts, command contents or credentials to a Token
Harness service. Your coding agent and any explicitly enabled provider keep their own network
behaviour.

Configuration changes require review; plans are checked again before apply. Managed writes retain
backups, preserve unrelated configuration and support verification and rollback. Unknown hook formats
or unsupported configuration rows require evidence instead of guessed writes.

## Need help?

- **Command not found:** check `node --version` and `npm list --global token-harness`, then reopen
  the terminal. Node must be at least 22.13.
- **Routing configured but no callback:** check the hook's enabled/trusted state in `/hooks`, start
  a new session and submit an ordinary prompt. You should never need to invoke the skill per prompt.
- **Optimizer unavailable:** open its setup/installation options; some dependencies remain
  user-installed prerequisites and some configuration rows have narrower support.
- **Quota unavailable:** a missing observation is not zero allowance. Use the status explanation;
  do not paste credentials to troubleshoot it.
- **Integration needs attention:** inspect `token-harness doctor --verbose` and
  `token-harness verify --verbose`; the reported verification tier explains what was actually checked.

[Windows notes](docs/windows-companions.md) · [CLI and evaluation guide](docs/cli-guide.md) ·
[Agent Skill](skills/token-harness/SKILL.md) · [Latest release](https://github.com/giuliastro/token-harness/releases/latest)

## Contribute and follow the plan

[Current progress and next steps](docs/plan-status.md) · [Full plan](PLAN.md) ·
[Accepted RFCs](docs/rfcs) · [Release readiness](docs/release-readiness.md)

To run a fresh source checkout:

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
npx --yes pnpm@10.33.4 install --frozen-lockfile
npm start
```

For an existing clone with dependencies installed, `npm start` builds and opens the local source.
Source changes do not reach npm users until a release is published.

Development checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm smoke`,
`pnpm package`, `pnpm smoke:install`. Use the pinned pnpm version above if Corepack is unavailable;
`corepack enable` is optional and can require administrator rights on Windows.
Read [contributor instructions](AGENTS.md) and accepted RFCs before changing public contracts.

## License

[Apache License 2.0](LICENSE). Referenced tools are independent projects with their own licenses.

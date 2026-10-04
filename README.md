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

A local browser dashboard opens. The browser app is the primary interface.
No Token Harness account or API key is required.
Your coding agent keeps its own authentication. Windows, macOS, Linux and WSL have explicit
compatibility checks; individual integrations may support a narrower set of versions/platforms.

Prefer to try it before installing globally?

```sh
npx --yes token-harness@latest
```

Updates for an `npx` launch use a new `npx` launch; automatic application updates require a verified
global npm installation.

## Your first five minutes

1. Open **Overview**. Token Harness detects your agents, installed optimizers and integration health.
2. **Review optimizer setup.** Start with RTK + HarnessTrim where the exact combination is supported.
   Each optimizer has its setup, verification and removal controls together.
3. **Preview and apply.** Check the proposed changes, then approve. Opening the dashboard alone does
   not change agent configuration.
4. **Authorize native hooks once.** In Codex, use `/hooks` to enable and trust the installed hooks.
   In Claude Code, ensure hooks are enabled and start a fresh session after changing them.
5. **Use your agent normally.** Return to **Results** to inspect observed evidence. “Configured” means
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
| **Measured results** | Search and filter sources; expand each result for before/after values and attribution. |
| **Safe maintenance** | Preview changes, retain backups, verify updates and remove owned configuration. |

See [automatic model routing](#automatic-model-routing) for supported agents, setup and benefits.

## Automatic model routing

Token Harness can add a short delegation policy to each submitted prompt through the agent's
native hooks. Your main model stays in charge: it decides whether an independent unit of work fits
a cheaper native subagent, starts that subagent, then reviews and integrates the result. One routed
worker runs at a time. The hook runs locally without a model call; routing can be enabled
independently of RTK, HarnessTrim or the optional Agent Skill.

Good candidates include repository exploration, test/log triage, mechanical edits and tests or
documentation with a clear specification. Quick tasks, unclear debugging, architecture, security,
releases and tightly coupled changes stay with the main model. If a requested model is unavailable,
the work stays on the main model; if a child's result fails its check, the main model finishes it.

The current policy requests these models **when the native harness makes them available**:

| Harness | Delegation policy |
| --- | --- |
| **Claude Code** | Fable can use Opus for hard independent work, Sonnet for bounded implementation/tests and Haiku for read-only/mechanical work. Opus can use Sonnet or Haiku; Sonnet can use Haiku for read-only/mechanical work; Haiku keeps the work. The policy requests an explicit native model alias. |
| **Codex** | Astra can use `gpt-6.1-sol` for bounded implementation/tests and `gpt-6-luna` for read-only/mechanical work. Sol/workhorse roots can use Luna; Luna keeps the work. The policy requests an explicit model and reasoning effort with a self-contained brief. |

The practical benefits are:

- **More selective use of your main model:** suitable routine work can run on a smaller model,
  potentially leaving more allowance for difficult work.
- **Review stays with the main model:** each delegated unit has a check and a fallback when its
  result is insufficient.
- **Less manual orchestration:** after setup and native authorization, use ordinary prompts;
  no skill invocation, prompt prefix or separate router launch is required.

### Install and authorize for each harness

After [installing Token Harness](#install-and-start), ensure `token-harness` is on the `PATH` used
by your coding agent. Open the dashboard, go to **Overview → Coding agents**, and select
**Enable routing** under the agent's **Automatic prompt routing** card. Review and apply the
preview. Setup merges user-scope hooks and preserves unrelated configuration.

| Harness | Reviewed routing configuration versions | Native activation after apply |
| --- | --- | --- |
| **Claude Code** (`--harness claude`) | **2.1.274–2.1.288** | Hooks are added to `~/.claude/settings.json`. Ensure hooks are enabled in `/hooks`, then start a fresh Claude Code session. |
| **Codex** (`--harness codex`) | **0.146.0**, **0.159.0–0.159.1**, **0.160.0** | Hooks are added to `~/.codex/hooks.json`. Open `/hooks` in the Codex CLI; review, enable and trust the three Token Harness hooks: `UserPromptSubmit`, `SubagentStart`, `SubagentStop`. Start a fresh session and submit an ordinary prompt. |
| **OpenCode, Hermes, Pi** | Automatic prompt routing is not implemented | Other optimizer integrations have their own support; there is no routing installation for these agents. |
| **Other harnesses** | Automatic prompt routing is not implemented | Use the agent's own model/delegation controls. |

**Codex is supported through its native hooks.** Trust is a separate native step: new or changed
definitions require review before they can run, as described in the
[official OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).
The versions above describe reviewed configuration schemas; other versions and prereleases are
blocked pending compatibility evidence. Platform launch formats are fixture-tested for Windows,
macOS, Linux and WSL; this does not establish live execution on every platform or Codex surface.

For terminal setup, choose the block for your agent. Each `plan` command is a dry run; replace
`<plan-id>` with its printed ID and inspect the changes before applying:

```sh
# Claude Code
token-harness plan --provider none --harness claude --agent-routing
token-harness apply --plan <plan-id> --yes
```

```sh
# Codex
token-harness plan --provider none --harness codex --agent-routing
token-harness apply --plan <plan-id> --yes
```

Complete the native activation step in the table even when installing through the CLI. The
dashboard can be closed afterward; the agent invokes the installed hooks itself.

### Verify, measure and disable

Submit an ordinary prompt in a fresh agent session, then inspect its routing card in **Overview**.
**Configured** / `config-only` means the definitions exist; **Trust required** means Codex still
needs authorization; **Active · callback seen** / `runtime-observed` means a real callback arrived.
Prompt callbacks prove the hook ran; child start/stop callbacks prove a native child lifecycle.
Neither proves the child used the requested model or saved allowance.

To disable, use **Disable routing** on the same card and review/apply the preview. The CLI
equivalent is below; replace `<harness>` with `claude` or `codex`:

```sh
token-harness plan --provider none --harness <harness> --disable-agent-routing
token-harness apply --plan <plan-id> --yes
```

Removal affects only owned hooks. Restart existing agent sessions so they reload the configuration.
Backups and [rollback](#update-disconnect-or-undo) use the normal transaction lifecycle.
See [the routing RFC](docs/rfcs/0030-automatic-native-prompt-routing.md) for policy and evidence rules.

## Results highlights

- **Up to 94.4% less TAP test-output text.** HarnessTrim reduced a recorded output from
  **3,531 to 198 characters**, keeping the test summary compact.
  [Output receipts](docs/evaluation/results/2026-10-04-native-pairs.json).
- **12/12 code acceptance passes.** Every coding result in the paired pilot passed its frozen
  acceptance suite, with **24–31 tests per run**.
  [Paired evaluation](docs/evaluation/native-pairs-2026-10-04.md).
- **Up to 3,000 local messages per 5h with GPT-6 Luna in Codex.** OpenAI's estimated capacity for
  **Plus and Standard Business** is **350–3,000 messages**, compared with **15–160 for GPT-6.1 Sol**.
  These are model-capacity estimates for planning native delegation.
  [Official usage estimates](https://learn.chatgpt.com/docs/pricing#what-are-the-usage-limits-for-my-plan).
- **Built to make your 5h and 7-day allowance go further.** Native routing guides your agent to
  delegate suitable routine work to smaller models, while the main model handles difficult decisions
  and final review.
  Output reduction and allowance-aware advice support the same goal: more accepted work within
  your subscription. [How routing works](#automatic-model-routing).

## Available optimizers

| Component | Purpose | Current role |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Reduce shell/tool output | Baseline integration on reviewed rows. |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic output/context reduction | Baseline integration on reviewed rows. |
| [mcptoon](https://github.com/activeing123/mcptoon) | Compact MCP discovery/manifests | Optional; install through an existing pipx or uv. Missing prerequisites show installation options. |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | Repository graph and MCP context | Optional reviewed integration; package/index preparation and license review are user responsibilities. |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | MCP context compression/retrieval | Optional configuration-only integration for an already-installed reviewed package. |
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
and choose **Install updates** to approve installation. It re-checks health automatically afterward.
A supported application update offers **Restart and re-check** to load the new version; if replacement startup fails, the
current dashboard stays available.

To update manually:

```sh
npm install --global token-harness@latest
token-harness
```

To disconnect an optimizer, use **Remove managed setup** beside that optimizer.
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

A configuration change requires an explicit review and approval; plans are checked again before apply.
Managed writes retain backups, preserve unrelated configuration and support verification and rollback. Unknown hook formats
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

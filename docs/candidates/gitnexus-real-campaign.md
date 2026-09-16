# GitNexus real campaign runbook

This runbook is for collecting **selection evidence**, not for promoting GitNexus.

## Admitted surface

Run the campaign only on the exact reviewed tuple:

- Claude Code `2.1.269`;
- GitNexus `1.6.12`;
- native Linux, non-WSL;
- Claude user config `~/.claude.json`;
- Token Harness ownership limited to `mcpServers.gitnexus`.

Do not reuse this campaign as evidence for adjacent Claude/GitNexus versions, macOS, Windows, WSL or
Codex. GitNexus remains a candidate and its PolyForm Noncommercial 1.0.0 licensing review continues
to block generic commercial-production promotion independently of technical results.

This autonomous row is intentionally **GitNexus-selection-only**. It does not install or activate RTK
or HarnessTrim and therefore does not validate the combined production stack. At this checkpoint the
reviewed RTK/HarnessTrim Claude compatibility rows do not include Claude Code `2.1.269`, so a separate
reviewed compatibility row is required before any combined-stack claim can be made. The managed
production stack itself remains RTK + HarnessTrim; this campaign does not change it.

## Autonomous GitHub Actions path

`.github/workflows/gitnexus-real-campaign.yml` is an **evaluation-only** runner for this exact row. It
runs on Ubuntu 24.04 with Node `22.18.0`, the minimum Node 22 line admitted by GitNexus `1.6.12`,
installs Claude Code `2.1.269` and GitNexus `1.6.12` into a runner-temporary npm prefix without sudo,
uses a runner-temporary HOME, builds the current Token Harness checkout, and executes the normal
candidate `apply`/`uninstall` plus `benchmark-start`/`benchmark-finish` evidence pipeline around real
Claude Code headless tasks. This evaluation-only Node selection does not change Token Harness's
ordinary CI/runtime floor, which remains Node `22.13.0`.

The workflow accepts either of the standard Claude Code CI credentials as repository secrets:
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Missing authentication fails closed before any model
call. Secrets are never printed or persisted in campaign artifacts.

Configure exactly one credential. For API-key runs the runner keeps the dollar budget guard. For
subscription OAuth runs it omits `--max-budget-usd`: Claude Code reports list-price accounting there,
which can terminate a valid subscription-backed task even when no paid overage is in use. OAuth runs
are instead bounded by explicit manual dispatch, eight fixed pairs, six turns per session and the
selected one-or-two-attempt ceiling.

The workflow is deliberately not part of ordinary pull-request CI and no longer runs automatically
on pushes to `main`. A real campaign starts only through `workflow_dispatch`, so repository maintenance
cannot silently spend Claude quota. The dispatch defaults to `haiku` and one attempt per variant; the
full eight-pair campaign therefore has a fixed default ceiling of 16 Claude sessions with no automatic
retry. Ordinary CI runs only `node scripts/evaluation/gitnexus-real-campaign.mjs --self-test`, which
uses synthetic stream events and spends no model quota.

For real tasks Claude is restricted to built-in `Read`, `Glob` and `Grep` tools; shell/edit/write/web
and subagent tools are unavailable. GitNexus MCP tools remain available only through the reviewed
Claude MCP registration. The same prompt is used for each baseline/optimized pair and asks Claude to
call a GitNexus MCP tool when one is exposed. Claude Code `stream-json` output provides two separate
witnesses:

- `system/init.mcp_servers` records whether the GitNexus MCP server is present for the session;
- an observed `tool_use` whose name begins `mcp__gitnexus__` records actual GitNexus use.

The second witness is the only one counted as actual candidate use. Availability alone never closes
the promotion `activation-verification` gate.

The runner uses two attempts at most per variant, records quality against deterministic answers and
source-file evidence, keeps Claude's effective model identical across the campaign, checks that the
tracked repository stays unchanged after every attempt, and stores sanitized stream logs plus one
schema-1 report artifact. Headless/API cost and usage fields are evaluation evidence only; they must
not be relabelled as Claude Pro five-hour or seven-day subscription-quota savings.

## One-time repository preparation

Use a repository that will remain at the same commit for the entire paired campaign. Before starting
a campaign, verify the GitNexus index explicitly:

```sh
claude --version
gitnexus --version
gitnexus status --json
```

The GitNexus status must be machine-readable schema 1 with:

```json
{"schemaVersion":1,"status":"up-to-date"}
```

Other fields may be present. If the repository is not indexed or the index is stale, prepare it
manually in an isolated evaluation environment:

```sh
gitnexus analyze --index-only
```

The autonomous evaluation workflow may perform that same one-time preparation inside its disposable
runner and records the indexing wall-clock cost separately. The shipped Token Harness product and
candidate lifecycle must never run `analyze`, create or refresh the index, install GitNexus, run
`setup`, or install hooks/skills automatically.

Then rerun `gitnexus status --json` and require `status: "up-to-date"` before starting a benchmark
capture.

The index may exist on disk during both variants. What matters for the paired experiment is that the
**baseline agent has no GitNexus access** while the optimized agent has exactly the reviewed MCP
surface. Do not add GitNexus skills, hooks or another MCP registration outside the Token Harness-owned
Claude entry.

## Start or resume the campaign

Use one campaign id for the complete paired series:

```sh
token-harness benchmark-matrix \
  --benchmark-id gitnexus-claude-eval-real1 \
  --candidate gitnexus \
  --harness claude
```

Follow only the `Next` command returned by the campaign engine. The standard campaign contains two
runs for each task class: mechanical, standard, hard and critical.

The campaign planner is responsible for the candidate-facing boundary around each pair:

- before a baseline it removes only the Token Harness-owned `mcpServers.gitnexus` entry;
- before an optimized capture it registers only that reviewed entry;
- after the optimized capture it records the finish boundary before removing the owned entry.

The installed GitNexus binary and repository index may remain present. They are not baseline access
unless Claude can actually reach GitNexus through an agent-facing surface.

## Pairing discipline

For every baseline/optimized pair keep the following equivalent:

- repository and repository commit;
- task wording and acceptance criteria;
- Claude Code version and model/settings;
- starting files and working-tree state;
- task-class assignment;
- quality scoring rule and retry policy.

RTK and HarnessTrim are outside this evaluation row rather than silently treated as validated. If a
future combined-stack campaign is run, its RTK/HarnessTrim versions and Claude compatibility must be
reviewed separately and then held equivalent across every pair.

Do not let the optimized run inherit files or conclusions produced by the baseline. Restore the same
starting repository state before each variant. If a task itself intentionally modifies files, retain
the result only as evidence and reset before the paired variant. The autonomous runner uses read-only
tasks and fails immediately if tracked repository content changes.

## What the witnesses prove

For GitNexus baselines, the campaign requires the GitNexus MCP witness to be `absent` at both task
boundaries. Any usable, unusable, ambiguous or missing state fails closed for GitNexus candidate
evidence.

For optimized runs, a witness of `usable` at both boundaries proves only **MCP availability**. It does
not prove that Claude called a GitNexus tool or that GitNexus contributed to the answer. Boundary
availability therefore must not pass the promotion `activation-verification` gate.

The autonomous runner additionally inspects Claude Code's real headless event stream. An optimized
variant has a positive actual-use witness only when at least one emitted `tool_use` is named
`mcp__gitnexus__...`. This evidence is stored separately from Token Harness's existing bounded MCP
boundary witness so configuration/availability cannot be confused with use.

Do not infer use from configuration, candidate attribution, the browser acknowledgement, or a good
benchmark result.

## Evidence to retain

For every pair retain the normal Token Harness benchmark evidence and evaluate at least:

- task/source correctness and regressions;
- attempts, failed attempts and retries;
- local token/context evidence when comparable;
- wall-clock timing when comparable;
- selection verdict and decision-readiness;
- baseline MCP absence and optimized MCP availability;
- the separate `mcp__gitnexus__...` real tool-use witness when observed.

Repository indexing cost should be recorded separately as setup/maintenance overhead, not hidden in a
savings claim. The campaign must not claim token, quota, subscription-time or money savings unless the
corresponding Token Harness evidence supports that exact claim. It must also retain the machine-readable
`combinedProductionStackEvidence: not-collected` boundary so GitNexus selection evidence cannot be
misread as RTK + HarnessTrim compatibility evidence.

## Stop conditions

Stop and do not repair evidence in place if any of these changes during the campaign:

- Claude Code is no longer exactly `2.1.269`;
- GitNexus is no longer exactly `1.6.12`;
- the environment is WSL or no longer native Linux;
- the repository index becomes stale;
- baseline exposes GitNexus to Claude;
- optimized GitNexus MCP is not uniquely usable;
- another GitNexus skill/hook/MCP surface contaminates either variant;
- repository/task/model conditions cannot be kept equivalent.

Start a fresh campaign after correcting the environment rather than rewriting historical receipts.

### 2026-09-16 frugal OAuth smoke

A branch-only Haiku smoke verified the external boundary before any full campaign was allowed. Claude
Code `2.1.269` authenticated with `CLAUDE_CODE_OAUTH_TOKEN`, reported subscription quota as allowed and
paid overage as rejected/not in use. A clean baseline completed before the optimized variant; the
optimized session exposed GitNexus `1.6.12` as connected, emitted real `mcp__gitnexus__context` and
`mcp__gitnexus__query` calls, and found the expected repository fact. The smoke intentionally remains
non-selection evidence. Its final CLI failure was the artificial low `--max-budget-usd` guard firing
after correct structured output, which is why OAuth campaigns no longer use that API-dollar guard.
No full eight-pair campaign was started from this smoke.

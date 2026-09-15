# GitNexus real campaign runbook

This runbook is for collecting **selection evidence**, not for promoting GitNexus.

## Admitted surface

Run the campaign only on the exact reviewed tuple:

- Claude Code `2.1.269`;
- GitNexus `1.6.12`;
- native Linux, non-WSL;
- Claude user config `~/.claude.json`;
- Token Harness ownership limited to `mcpServers.gitnexus`;
- production optimization stack kept at RTK + HarnessTrim.

Do not reuse this campaign as evidence for adjacent Claude/GitNexus versions, macOS, Windows, WSL or
Codex. GitNexus remains a candidate and its PolyForm Noncommercial 1.0.0 licensing review continues
to block generic commercial-production promotion independently of technical results.

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
manually in this isolated evaluation environment:

```sh
gitnexus analyze --index-only
```

Then rerun `gitnexus status --json` and require `status: "up-to-date"` before starting a benchmark
capture. Token Harness must never run `analyze`, create or refresh the index, install GitNexus, run
`setup`, or install hooks/skills automatically.

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
- RTK and HarnessTrim versions/configuration;
- starting files and working-tree state;
- task-class assignment;
- quality scoring rule and retry policy.

Do not let the optimized run inherit files or conclusions produced by the baseline. Restore the same
starting repository state before each variant. If a task itself intentionally modifies files, retain
the result only as evidence and reset before the paired variant.

## What the witnesses prove

For GitNexus baselines, the campaign requires the GitNexus MCP witness to be `absent` at both task
boundaries. Any usable, unusable, ambiguous or missing state fails closed for GitNexus candidate
evidence.

For optimized runs, a witness of `usable` at both boundaries proves only **MCP availability**. It does
not prove that Claude called a GitNexus tool or that GitNexus contributed to the answer. Boundary
availability therefore must not pass the promotion `activation-verification` gate. A future positive
activation claim requires a separate bounded witness of real candidate use.

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
- any independently attributable real GitNexus-use witness, if one becomes available.

Repository indexing cost should be recorded separately as setup/maintenance overhead, not hidden in a
savings claim. The campaign must not claim token, quota, subscription-time or money savings unless the
corresponding Token Harness evidence supports that exact claim.

## Stop conditions

Stop and do not repair evidence in place if any of these changes during the campaign:

- Claude Code is no longer exactly `2.1.269`;
- GitNexus is no longer exactly `1.6.12`;
- the environment is WSL or no longer native Linux;
- the repository index becomes stale;
- baseline exposes GitNexus to Claude;
- optimized GitNexus MCP is not uniquely usable;
- another GitNexus skill/hook/MCP surface contaminates either variant;
- repository/task/model/production-stack conditions cannot be kept equivalent.

Start a fresh campaign after correcting the environment rather than rewriting historical receipts.

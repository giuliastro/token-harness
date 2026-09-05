# Windows companion setup

Token Harness keeps coding-agent configuration and user-installed optimization providers separate.
It detects what is already present, recommends updates, and only changes configuration after an
explicit reviewed plan/apply flow.

## Recommended first-run sequence

```powershell
npm install --global token-harness@latest
token-harness doctor
token-harness update
token-harness verify
token-harness budget
token-harness optimize
```

`token-harness update` is a dry run. It checks the package channels for newer RTK/HarnessTrim
versions without changing them. Use `token-harness update --yes` only after reviewing the proposed
versions.

## Claude quota on Windows

Claude live quota is optional and read through the installed `cclimits` companion. Token Harness
uses the cacheless JSON contract and accepts the current zero-config Claude sources introduced by
cclimits 1.7.0:

- Claude Code OAuth, when already signed in;
- Claude Desktop OAuth on Windows, read-only;
- Claude Code's fresh cached usage snapshot as the no-auth fallback.

Token Harness does not initiate a Claude login and does not ask cclimits to write its cache. To use
this optional quota source, install or refresh the companion explicitly:

```powershell
npm install --global cclimits@latest
cclimits --claude --json --no-cache-write --no-stale-fallback
token-harness budget --harness claude
```

The companion remains optional: without it, Token Harness reports Claude subscription quota as
`unavailable` rather than inferring quota from local token counts.

## RTK and PowerShell

Claude Code on Windows can route shell calls through both `Bash` and `PowerShell`. Token Harness
checks both families. A Bash-only RTK hook is therefore incomplete on Windows even when RTK itself
is healthy.

The native `rtk hook claude` processor consumes Claude's `tool_input.command`, so Token Harness can
register the same native hook command for a missing `PowerShell` matcher. This is separate from
RTK's own installer, whose first-class PowerShell installation/status path is still being tracked
upstream.

Token Harness has live Windows recordings for Claude Code 2.1.251 with both RTK 0.44.0 and RTK
0.48.0. Those recordings exercise Bash and PowerShell setup, a direct PowerShell hook payload,
drift, verified rollback, and surgical uninstall. RTK 0.48.0 is therefore inside the current
tested provider range rather than being treated as an unknown newer build.

The change is reviewable and reversible: Token Harness appends only the missing matcher entry to
Claude's `PreToolUse` hook list and snapshots the settings file before apply.

## HarnessTrim versions

Token Harness should prefer the newest version it knows how to inspect, but it must not silently
replace a provider binary the user installed. HarnessTrim 0.2.1 is within the currently understood
provider contract. Older installed copies can be surfaced by `token-harness update` and upgraded
explicitly.

Managed configuration is stricter than executable detection: automatic mutation still requires a
reviewed provider × harness × platform compatibility row. That distinction prevents a newly
published provider version from silently changing a coding-agent configuration before the exact
write set has been recorded.

## Optional harness integrations

Installing Pi, Hermes, OpenCode, Claude Code, or Codex does not imply that every optimization
provider must be installed into every harness. `verify` checks integrations that exist. For example,
Pi without a HarnessTrim extension is simply an unconfigured optional integration, not a failed
verification.

# Native Linux routing verification — 2026-10-04

Both Codex and Claude Code emitted real `UserPromptSubmit` callbacks in two new native
sessions/projects with the published Token Harness 0.1.28 package. A genuine Codex child emitted
one start/stop pair. Preview/apply, disable and rollback preserved unrelated settings and restored
both original configuration files byte for byte. These results complete the Linux callback and
lifecycle coverage of [#359](https://github.com/giuliastro/token-harness/issues/359).

Claude's existing authentication points to a missing CCR `apiKeyHelper`. Its prompt hooks ran
successfully before model access; neither Claude model turn completed. Native Windows still needs
the published-artifact recheck: the earlier [Windows audit](2026-10-04-local-fixes.md) used a locally
patched build. The issue therefore remains open for that specific gate.

## Recorded installation

| Component | Exact observation |
| --- | --- |
| Platform | Native Linux x86_64; kernel `7.0.0-34-generic`; not WSL |
| Node | `v24.13.0` |
| Codex CLI | `0.159.0` |
| Claude Code | `2.1.274` |
| Tested Token Harness | Public npm `0.1.28`, installed in an isolated temporary prefix |
| User's global Token Harness | `0.1.26`, unchanged |

The public npm tarball matches the GitHub release asset with SHA-256
`f2578b44f512b7577b39811298eb556fbafc62ffb93aab8afb077216691e6eb9`.
The installed `token-harness.mjs` has SHA-256
`3d1f342325963558fd445e74dcfb70bccf4b8265f858fea46baa7c0b4d1c1004`.
Each native process inherited the published installation's bin directory first on `PATH`, so its
unqualified routing hook command resolved to that installation. No source bundle or synthetic
invocation of the internal callback command supplied these receipts.

## Fresh-session runtime receipts

Project names below are public aliases for distinct fresh Git directories. Timestamps are UTC.
The ordinary prompt was `Reply exactly ready. Do not use tools or change any files.` It contained
no skill invocation or routing command prefix.

| Harness / project | Native result | Real routing receipts |
| --- | --- | --- |
| Codex / A | Exit 0; native turn completed | Prompt at `11:47:00.859Z` |
| Codex / B | Exit 0; native turn completed | Prompt at `11:50:41.643Z` |
| Codex / child | Exit 0; native collaboration wait and turn completed | Prompt at `11:52:33.425Z`; start at `11:52:43.304Z`; stop at `11:52:47.157Z` |
| Codex / disabled | Exit 0; native turn completed | None |
| Codex / re-enabled | Exit 0; native turn completed | Prompt at `11:55:00.557Z` |
| Claude / A | Native initialization followed by 10 API retries; collector timed out after 150 seconds | Prompt at `11:47:05.030Z` |
| Claude / B | Native hook response: exit 0, outcome `success`; collector stopped after callback, native exit 143 | Prompt at `11:57:32.302Z` |
| Claude / disabled | Native initialization followed by API retries; collector stopped, native exit 143 | None |

The positive A/B receipts refer to different project identifiers for each harness and came from
separate CLI processes. Claude B's native stream explicitly records `hook_started` and
`hook_response` for `UserPromptSubmit`. Claude A was invoked without `--include-hook-events`, so
its receipt is corroborated by the native process window and receipt file rather than a streaming
hook-response event. Claude B was deliberately stopped after observing the callback to avoid more
known authentication retries. The disabled Claude probe reached native initialization with no
routing receipt or routing hook event; it does not establish successful model access.

The child trial requested exactly one native child to read a tiny README, wait and finish without
edits or nested CLI/hook invocations. The native stream records a completed collaboration wait,
and the routing collector records the genuine child lifecycle. Both child receipts report
`agentType: default` and `model: null`. A requested model name does not establish the actual model.
No Claude child was emitted, and none is inferred.

## Configuration, authorization and rollback

- Published CLI plans previewed the owned actions before `apply --plan <id> --yes`. Claude enable
  and Codex re-enable each merged one configuration action; disable removed three owned event
  entries for each harness. Existing RTK, HarnessTrim and unrelated settings survived all changes.
- While enabled, the live routing API reported `managed`, `enabled` and `runtime-observed` after
  the real callbacks. Immediately after the first Claude installation, before any callback, the
  evidence tier was only `config-only`.
- Disabled configurations reported `absent`, `Disabled`, `config-only` and enablement `unknown`.
  Historical receipt counters remained visible; they did not turn the disabled state into a
  runtime claim. Fresh disabled native processes produced zero new routing receipts.
- Codex re-enable rollback restored the disabled bytes; disable rollback restored its original
  bytes. Claude disable rollback restored enabled bytes; enable rollback restored its original
  bytes. Current digests were checked before rollback to avoid overwriting intervening user edits.
- An isolated copy of Codex's hook configuration was read by the actual native `app-server`
  `hooks/list` API. It reported all three routing hooks enabled but `trustStatus: untrusted`.
  This is native authorization metadata, not runtime callback evidence. The isolated server ran
  no model call or hook, and no trust grant or bypass was used.
- The final configuration matches the initial bytes for both agents: Codex routing remains
  enabled/trusted, while Claude routing returns to its original absent state. The collector UI
  was stopped. Authentication settings, persistent trust and the user's global package were not
  changed.

## Evidence limits and reproduction

[The sanitized audit](results/2026-10-04-linux-native-routing.json) records all eight trials,
stream hashes, callback timestamps, negative results, lifecycle invariants and observed tiers.
Totals attributable to these probes are four Codex prompts, one Codex child start/stop pair and
two Claude prompts. Dashboard lifetime totals are separately labeled. Full native streams,
stderr and configuration backups remain in a private ignored local directory; transcripts,
credentials and personal paths are excluded from the public audit.

To reproduce, record the native versions and the published package hashes, save private
configuration backups, and prepend its installed bin directory to each native process's `PATH`.
Use the published CLI `plan --provider none --harness <codex|claude> --agent-routing --json`, then
apply the reviewed plan. Create two new Git projects and submit the ordinary prompt in a separate
native process for each:

```text
codex --ask-for-approval never exec --sandbox read-only --json --cd <fresh-project> <prompt>
claude --print --verbose --include-hook-events --output-format stream-json <prompt>
```

Match newly written receipts to the native process windows and distinct projects; never count a
manual hook call. Preview/apply `--disable-agent-routing`, run a fresh negative probe, and restore
the owned transactions in reverse order with `rollback --plan <id> --yes`, checking the expected
live digest before every rollback. Never replace a newly edited configuration with an old backup.

Codex stderr retained native rollout-persistence warnings. Exit 0 and `turn.completed` establish
the observed turns and callbacks, not durable native session persistence. Claude's failed or stopped
model turns remain failed or stopped in the audit; successful hooks do not repair authentication.
There was no paired token, quality, cost or attributable quota experiment. These callbacks establish
runtime integration, not savings. Windows published-artifact verification and paired benefit remain
separate gates.

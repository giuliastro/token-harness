# RFC 0030 — Automatic native prompt routing and evidence

- Status: Accepted for implementation
- Date: 2026-10-03
- Owners: Token Harness
- Extends: RFC 0002, RFC 0004, RFC 0005, RFC 0007, RFC 0013, RFC 0014, RFC 0029

## Summary

Token Harness can install a user-scope native hook for Codex and Claude Code. On every submitted
prompt, the hook adds a short policy reminder so the active harness can decide whether a bounded,
independent coding unit should use one native subagent on a cheaper supported model. The native
agent remains responsible for starting that subagent. The root model and provider are never changed.

This makes the behavior automatic after one reviewed enable action. Users do not need to invoke a
Token Harness skill or prefix prompts with a command. A dashboard control enables or disables the
hook, shows configuration and runtime receipts separately, and reports savings only from existing
paired, quality-gated benchmark evidence.

## Decision

### Prompt policy

- On each prompt, ask the native agent to consider a single bounded subagent only when work is
  substantial, independent, and does not require the root model's judgment throughout.
- Codex requests `gpt-6-luna` when that model is currently available and the root is not already
  running it. Claude Code requests its current native `haiku` alias when the Agent tool is available.
- Keep trivial work, architecture, security, release decisions, tightly coupled edits, user-directed
  no-delegation work, and unavailable models on the root model.
- The root agent integrates and verifies the result. A prompt instruction is a request; it does not
  dispatch a model by itself and does not prove the selected or executed model.
- The hook is local and deterministic. It makes no model/API request and installs no router, proxy,
  gateway, MCP server, or third-party package.

### Installation, removal, and state

The guided app shows **Automatic prompt routing** as a first-class feature on each detected harness.
Enable and disable both use the existing preview, approval, journal, drift-check, verification, and
rollback lifecycle. They merge or surgically remove only Token Harness-owned JSON array entries.
Existing hook groups, user-owned entries, comments, formatting, and unrelated settings are preserved.
Malformed/JSONC files, conflicting same-purpose hooks, untested harness versions, and modified
owned entries fail closed.

Claude loads the user hook after settings are re-read or the next session starts. Codex requires the
user to review and trust the exact hook in `/hooks`; configuration alone remains `pending trust`.
Runtime state becomes `observed` only after Token Harness receives a real prompt or subagent hook
callback. Disabling routing removes its owned hook entry and stops future callbacks; already-running
sessions may retain the old hook until restarted.

### Runtime receipts and privacy

The hook records bounded local JSONL events for `UserPromptSubmit`, `SubagentStart`, and
`SubagentStop`. A receipt contains only the event name, harness, timestamp, a salted project ID,
schema version, and model/agent type when the harness actually reports them. It never stores prompt
text, tool input, transcript content or path, subagent response, account identifiers, or raw session
or agent IDs. Logging failures do not block the submitted prompt or native agent.

Codex's `model` hook field may establish the active model slug for that callback. Claude's documented
subagent hook payload has no model field; Token Harness reports the child start/stop but leaves its
model unknown unless a future versioned adapter can verify a stable runtime field. Requested model,
actual model, and unavailable model remain distinct.

### Results and savings

The dashboard reports prompt callbacks, started/stopped native subagents, and runtime model labels
where available. Exact local token counts and exact/estimated reducer results keep their existing
measurement classes and units.

Model-routing token savings are credited only to matched baseline/optimized tasks on the same
harness and task class where the baseline started with routing disabled, the optimized task started
with routing enabled and recorded a subagent callback, both quality gates passed, and both variants
have local token usage. The result is `baseline tokens - routed tokens`; negative results remain
negative. Without those receipts, the dashboard says **Not measured yet**.

Five-hour and weekly quota savings come only from authoritative paired quota-window deltas for the
same qualifying comparison. They remain separate percentages, are never summed, and are never
converted to local tokens, API prices, or money. Current allowance levels are observations, not
savings. Subagent starts, model names, local token counts, and an API price difference alone do not
prove subscription savings. Quality regression blocks a positive savings claim.

### Platform and verification

Claude and Codex hook formats live behind their harness adapters. Windows, macOS, Linux, and WSL
configuration and process invocation are explicit and fixture-tested. Codex trust is a native
manual step; this is surfaced before the feature is called active. A Windows test must exercise the
actual Claude Code hook on the user's configured machine and confirm its hook receipt in Token
Harness before that platform is called runtime-verified.

## Consequences

### October 3 compatibility repair

Configuration fixtures admit Codex 0.159.0–0.159.1 and 0.160.0, and Claude 2.1.274–2.1.288.
These bounds describe the documented hook schema, never cross-platform runtime verification.
Unknown/prerelease formats remain blocked with the installed version and an update action.
Windows Claude uses shell form because native exec form cannot start npm `.cmd` shims.
An earlier exec-form entry is repaired only when its exact digest is owned by a committed journal;
repair removes those three entries and installs the replacement through the normal transaction.
External or edited hooks remain untouched. Removal also recognizes these older owned entries.
Stored-plan apply reuses the reviewed harness selector during postcondition verification;
omitting `--harness` on `apply --plan` must not undo an otherwise correct hook installation.

The dashboard reads exact Codex routing tuples from `hooks/list`, distinguishes authorization
required, disabled, ready and runtime observed, and polls bounded receipts while visible.
Overview callbacks span projects; benchmark callbacks retain project and task-time boundaries.
No skill invocation is required for individual prompts. Codex still requires one native trust
review for new or changed definitions; Token Harness neither grants nor bypasses that trust.

The hook runs once per submitted prompt, so its context must stay short and its local work bounded.
The subagent policy may increase total usage; only paired usage and quality evidence can show whether
it saves tokens or quota. Claude model identity and token counts may remain unavailable to Token
Harness when Claude does not expose them through a stable event. In that case the interface reports
the receipt tier it did observe and leaves model/token attribution unknown.

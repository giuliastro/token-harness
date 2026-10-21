# Test the interface-first desktop candidate

Use the **Desktop packages** workflow run linked from the candidate PR. Wait for all
four native package jobs to be green, then download the artifact for your computer:

| Computer | Artifact | Open |
| --- | --- | --- |
| Native Windows x64 | token-harness-desktop-win-x64 | Extract ZIP, run the setup EXE, launch from Start |
| macOS Apple Silicon | token-harness-desktop-mac-arm64 | Copy the app from DMG/ZIP into Applications |
| macOS Intel | token-harness-desktop-mac-x64 | Copy the app from DMG/ZIP into Applications |
| Linux x64 | token-harness-desktop-linux-x64 | Install DEB or extract TAR.GZ into a permanent directory |

GitHub sign-in may be required for Actions artifacts. Record the PR commit and run
URL: candidate packages use the source commit's version, which may not yet have a
published release. These test installers remain unsigned on Windows and ad-hoc signed on
macOS; no new signing/notarization claim is made. Keep the existing application
path while installed hooks depend on it. Do not uninstall an existing working
installation just to try a candidate; use the same path for a reviewed replacement
or a separate user/test environment with its own agent configuration.

## Everyday desktop checks

1. Launch from the OS menu. Home, Methods and Details should retain the new design.
   **File → Open project** selects a disposable project. Close and reopen: it should
   reopen that folder. If that folder has been removed, it should use home.
   The page footer and **Help → About Token Harness** should show the same version
   as the installed release. The packaged runtime smoke checks this version too.
2. Launch the app a second time: focus should return to the existing window.
3. On macOS, starting outside Applications should offer a move before starting the
   configuration backend. Cancelling must leave agent configuration untouched.
4. **Details → Checks and maintenance → Check for updates** should describe desktop
   downloads and offer the release link. It should not tell the desktop user to
   install the global npm CLI. Provider updates still require their existing review.
5. **Details → Advanced tools → Prepare to remove the app** is a review checklist.
   Merely opening it changes nothing. Each owned provider/routing connection opens
   the usual preview and approval flow. Reopen the checklist after each change.
   External connections and custom skills require separate review; the checklist
   does not intercept OS uninstall or certify every external hook.

## Advice and handoff

- **Plan my workload:** choose the agent, task, profile, reserve and an explicit
  remaining task count when known. Get advice. No model/policy setting should change.
- **Compare coding agents:** enter real task counts. Missing matched quality or
  allowance evidence must remain unknown; the app must not invent an allocation or
  switch agents. Expand the technical report to inspect evidence and limitations.
- **Prepare a handoff:** enter objective, next action and optional facts/checks.
  Create and copy the summary. This only formats text; it does not read those file
  names, call a model or transfer a session. Large inputs may need shortening.

## Four-arm comparison and recovery

This is an advanced experiment. Preparation can temporarily modify **owned
user-level agent configuration as well as project settings**. Use a test environment
or review the changes with that scope in mind. Required supported RTK/HarnessTrim
and routing setup must already exist. A refusal on an unsupported/brownfield stack
must explain the limitation and change nothing.

1. Open **Four-arm comparison**. Choose a short lowercase name; reuse it to resume
   this comparison or read its report after reopening. Select the agent/task, arm,
   and initial Git commit or fixture identifier.
2. **Review step** must change nothing. Cancel once to test this. Prepare a fresh
   preview, then **Apply reviewed step**. Changing configuration between preview and
   approval must refuse the outdated plan, preserving backups.
3. Start a fresh coding-agent session, approve native hooks there if required, run
   the same task and acceptance checks, then select **Record outcome and restore**.
   Record actual attempts, failed attempts and quality; leave unverified quality
   unknown. Review, then approve. The engine records the outcome and restores the
   saved configuration. No executable checks are run by the GUI.
4. Repeat from the same source-tree starting point for each of the four arms.
   The app does not reset Git or run the coding task. **Read the four-arm report**
   preserves quality gates and unknown evidence; completion is not proof of savings.
5. To cancel an active prepared arm, use the existing **Review benchmark recovery**
   control. Test preview/cancel, reopen, and reviewed restoration. Drift must block
   restoration and preserve recovery data. A CLI-created capture with a saved
   executable check must be refused by GUI finish; configuration-only recovery
   remains separately available.

Candidate campaign progression, transfer evaluation/receipt recording and direct
executable checks still have their advanced CLI workflows; they are not presented
as completed GUI parity in this PR.

## Concurrency and real-platform evidence

Only CLI and desktop builds containing this change cooperate in the managed-change
reservation. Do not run the published older CLI concurrently with this candidate;
for a contention test use the CLI bundle from the same PR. During a long approved
change, a second managed mutation must be refused before dispatch. Read-only checks
and ordinary native hook callbacks remain independent. A reservation is released
by the OS on process exit; an interrupted journal can still require recovery.

After an approved integration setup, close the window and exercise the real agent:
record exact versions, genuine hook activity, runtime verification tier and evidence.
Repeat after a reviewed upgrade. Keep native Windows and WSL separate. Green unit
tests and packaged renderer smoke do not prove installer lifecycle, provider
execution, authentication/trust, measured savings or full #379 acceptance.

For source testing, use branch `codex/desktop-interface-first` in a separate checkout,
install the frozen development dependencies, then run `pnpm build` and
`node dist/bundle/token-harness.mjs start`. Build native installers with
`pnpm desktop:package`. Unit tests never install providers or call models.

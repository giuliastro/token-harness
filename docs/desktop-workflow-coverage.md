# Desktop workflow coverage

Issue #379 coverage as of October 21, 2026. A status or generated command alone does
not count as a complete interface workflow. The desktop reuses the guided browser
application and transaction engine; RFC 0032 remains proposed.

| Workflow | Guided UI / desktop coverage | Remaining work |
| --- | --- | --- |
| Diagnostics and verification | Home and Details read capabilities, health, rules and verification tiers. **Re-check health** (Details → Checks and maintenance) rechecks supported integrations. | Real provider/harness execution remains a separate evidence gate. |
| Setup and maintenance | Stored-plan preview, single-use approval, setup, owned removal and reviewed updates through `guided.ts`. Unsupported prerequisites are explained. | Platform/runtime admission controls availability; desktop updates use manual replacement. |
| Policies, skills and routing | Supported preference, skill and prompt-routing lifecycle controls and observed callbacks. | Native trust/authentication steps and unsupported/advanced policy flows remain external or CLI-only. |
| Measurements | Details filters sources, measurement classes/units and provenance; paired quality/quota stays distinct from current activity. | Comparable real measurements remain #360 work; activity does not create a baseline. |
| Benchmarks | Reviewed manual paired captures; Details advanced tools also preview/apply four-arm preparation against the exact engine plan, record manual outcomes, restore configuration and read factorial reports. | Native tasks/checks and source-tree reset remain explicit outside the app. The GUI refuses saved executable checks even with approval. Candidate campaign progression and transfer receipt recording retain their CLI workflow. |
| Planning and handoff | Advanced tools expose optimize reserve/profile/task count, explicit mixed-workload schedule advice and compact handoff formatting through bounded local operations. | Schedule stays advisory; missing quality/allowance stays unknown. Transfer evaluation/receipts and custom context snapshot input remain CLI-only. |
| History and configuration recovery | Details → Change history shows 20 retained project operations, including earlier app/CLI sessions. Review restore targets only the machine's latest committed configuration transaction through guarded rollback. **Review benchmark recovery** discovers the active lease for the current project, then previews or applies restoration. | Package and arbitrary historical recovery remain CLI workflows. Benchmark restoration reuses `benchmark-restore`; drift or invalid/missing checkpoint blocks apply while preserving recovery data. |
| Project selection and distribution | Native folder chooser and remembered project with safe home fallback; single desktop instance; macOS stable-installation prompt; desktop update download guidance; owned-connection removal checklist. Seven release assets plus checksum are verified before publishing a new draft; desktop provenance is attested. | Full native install/update/removal and post-close integration recordings remain. Windows signing and macOS notarization are deferred; the checklist does not intercept OS uninstall or certify external connections. |
| Concurrent mutation | Updated installed CLI/UI entry points hold a platform reservation around managed mutations, verification and rollback. Reads and ordinary native hook callbacks stay independent. | Older clients do not participate. Conservative port collisions refuse a write; interrupted journals keep their existing recovery requirements. |

History uses `guided-operation-history.ts`, `/api/operations`, the `restore-latest`
preview and Details controls in `guided-product-client.ts`. The browser receives
fixed summaries, without paths, configuration contents or transaction selectors.
Tests reopen a service against retained journals and restore original configuration
bytes through the real engine using temporary directories and fake runners.

Guided benchmark recovery uses the private `GET benchmark-recovery` route to discover
the active lease for the selected project and the `benchmark-recover` preview/apply
action. Apply delegates to the existing `benchmark-restore` engine, including its
drift and checkpoint guards. It only restores the prepared arm: it does not finish a
capture, record quality, run a task or check, or launch a model. Test on a disposable
project after preparing an arm with the CLI or Advanced tools, then reopen Desktop, preview and cancel,
and finally apply and verify the original files, modes and absent paths. A clean
Desktop UI flow does not prove provider hook execution or runtime compression; the
Windows `workspace-write` verification gap remains explicit.

## Validation boundary

Native desktop CI builds and isolated packaged runtime/renderer/backend smoke
checks do not prove provider execution, hook use after close, upgrades/recovery or
savings. Linux Xvfb smoke does not cover all graphical/system-library combinations.
Windows is native; WSL remains a separate CLI environment. The published Windows
stack (#255), callbacks (#359) and paired measurements (#360) retain their own gates.

See the [interface-first desktop candidate guide](testing-desktop-interface-first.md)
for the current PR artifacts and its manual checks. The older
[Harness Remote guide](testing-prs-with-harness-remote.md) retains its historical
project-matching, capture and native-evidence instructions; use the latest candidate
run rather than a preceding PR's packages.

## Local Codex acceptance gate before closing #379

The CI desktop builds and isolated smoke tests establish packaging feasibility, not full
end-user acceptance. Keep issue #379 open until the following evidence is attached.

Run against a **fresh installed desktop package** for each of Windows x64, macOS
(available x64/arm64) and Linux x64; do not substitute `pnpm start` or the local
browser preview. Record platform, OS version, package artifact SHA-256, app version,
installation path, CLI version, optimizer versions and whether a separate global npm
CLI or WSL installation exists.

| Case | Manual procedure | Evidence and pass condition |
| --- | --- | --- |
| First run | Launch app with a new OS user/profile; inspect detection and missing-prerequisite guidance | Can reach dashboard without terminal; no unapproved changes |
| Setup + brownfield | Start with one manually configured harness; preview, approve and apply one supported optimizer | Only reviewed owned writes; manual configuration stays intact |
| Verify + observe | Re-check health, inspect measurement provenance and actual routing callback details | Configuration-only is not labeled runtime evidence; unknown measures stay unknown |
| Maintenance | Update a provider from the UI, then inspect notification and installed version | Stale banner disappears without page refresh; exact active executable verified |
| Undo | Undo a managed configuration mutation after deliberately editing an unrelated setting | Saved owned state restored; unrelated edit preserved or safe conflict shown |
| Close and reopen | Quit desktop app after setup; exercise installed agent integration in a separate terminal; reopen | Native integration survives app shutdown |
| Coexistence | Install a different-version global npm CLI and (where relevant) WSL copy | Desktop version/path are explicit; no cross-install silent upgrade or race |
| Interrupted operation | Interrupt a staged operation on a disposable test profile, then relaunch and review recovery | No untracked partially applied state; usable guarded recovery |
| Desktop update | Replace the package at the documented path and relaunch | State preserved; desktop does not mutate an npm global install |

Use `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm desktop:smoke`
for repository-level validation. These commands complement, not replace, installed-package
validation. Attach a per-platform log with successes, failures and reproduction steps.

**Release blockers:** signing/notarization and release distribution decisions must be recorded
separately. Do not mark the desktop issue complete based solely on unsigned CI artifacts.

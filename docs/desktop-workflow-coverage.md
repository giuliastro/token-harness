# Desktop workflow coverage

Issue #379 coverage as of October 10, 2026. A status or generated command alone does
not count as a complete interface workflow. The desktop reuses the guided browser
application and transaction engine; RFC 0032 remains proposed.

| Workflow | Guided UI / desktop coverage | Remaining work |
| --- | --- | --- |
| Diagnostics and verification | Overview reads capabilities, health, rules and verification tiers. Health actions recheck supported integrations. | Real provider/harness execution remains a separate evidence gate. |
| Setup and maintenance | Stored-plan preview, single-use approval, setup, owned removal and reviewed updates through `guided.ts`. Unsupported prerequisites are explained. | Platform/runtime admission controls availability; desktop updates use manual replacement. |
| Policies, skills and routing | Supported preference, skill and prompt-routing lifecycle controls and observed callbacks. | Native trust/authentication steps and unsupported/advanced policy flows remain external or CLI-only. |
| Measurements | Results filters sources, measurement classes/units and provenance; paired quality/quota stays distinct from current activity. | Comparable real measurements remain #360 work; activity does not create a baseline. |
| Benchmarks | Reviewed manual baseline/optimized capture and outcome recording, retained across app reopen; advanced command guide and supported candidate controls. | Factorial preparation, direct executable checks, scheduling and handoff remain advanced/CLI workflows. |
| History and configuration recovery | Results shows 20 retained project operations, including earlier app/CLI sessions. Review restore targets only the machine's latest committed configuration transaction through guarded rollback. **Review benchmark recovery** discovers the active lease for the current project, then previews or applies restoration. | Package and arbitrary historical recovery remain CLI workflows. Benchmark restoration reuses `benchmark-restore`; drift or invalid/missing checkpoint blocks apply while preserving recovery data. |
| Project selection and distribution | Native folder chooser; Windows x64, Linux x64, macOS x64/arm64 artifacts. Hooks reference the installed runtime. | Fresh-install/update/recovery and post-close native integration recordings remain. Windows signing and macOS notarization are deferred. |

History uses `guided-operation-history.ts`, `/api/operations`, the `restore-latest`
preview and Results controls in `guided-product-client.ts`. The browser receives
fixed summaries, without paths, configuration contents or transaction selectors.
Tests reopen a service against retained journals and restore original configuration
bytes through the real engine using temporary directories and fake runners.

Guided benchmark recovery uses the private `GET benchmark-recovery` route to discover
the active lease for the selected project and the `benchmark-recover` preview/apply
action. Apply delegates to the existing `benchmark-restore` engine, including its
drift and checkpoint guards. It only restores the prepared arm: it does not finish a
capture, record quality, run a task or check, or launch a model. Test on a disposable
project after preparing an arm with the CLI, then reopen Desktop, preview and cancel,
and finally apply and verify the original files, modes and absent paths. A clean
Desktop UI flow does not prove provider hook execution or runtime compression; the
Windows `workspace-write` verification gap remains explicit.

## Validation boundary

Native desktop CI builds and isolated packaged runtime/renderer/backend smoke
checks do not prove provider execution, hook use after close, upgrades/recovery or
savings. Linux Xvfb smoke does not cover all graphical/system-library combinations.
Windows is native; WSL remains a separate CLI environment. The published Windows
stack (#255), callbacks (#359) and paired measurements (#360) retain their own gates.

See [testing unmerged PRs with Harness Remote](testing-prs-with-harness-remote.md)
for candidate packages, project matching, manual capture, guided benchmark recovery
and native evidence checks. Use the green **Desktop packages** run attached to the
benchmark-recovery PR; builds from preceding PRs do not contain this recovery control.

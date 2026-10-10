# Desktop workflow coverage

Issue #379 coverage as of October 9, 2026. A status or generated command alone does
not count as a complete interface workflow. The desktop reuses the guided browser
application and transaction engine; RFC 0032 remains proposed.

| Workflow | Guided UI / desktop coverage | Remaining work |
| --- | --- | --- |
| Diagnostics and verification | Overview reads capabilities, health, rules and verification tiers. Health actions recheck supported integrations. | Real provider/harness execution remains a separate evidence gate. |
| Setup and maintenance | Stored-plan preview, single-use approval, setup, owned removal and reviewed updates through `guided.ts`. Unsupported prerequisites are explained. | Platform/runtime admission controls availability; desktop updates use manual replacement. |
| Policies, skills and routing | Supported preference, skill and prompt-routing lifecycle controls and observed callbacks. | Native trust/authentication steps and unsupported/advanced policy flows remain external or CLI-only. |
| Measurements | Results filters sources, measurement classes/units and provenance; paired quality/quota stays distinct from current activity. | Comparable real measurements remain #360 work; activity does not create a baseline. |
| Benchmarks | Comparison command guide and supported candidate campaign/readiness controls. | General stack preparation/start/finish/factorial/restore still requires CLI commands. Scheduling and handoff remain CLI-only. |
| History and configuration recovery | Results shows 20 retained project operations, including earlier app/CLI sessions. Review restore targets only the machine's latest committed configuration transaction through guarded rollback. | Package, benchmark and arbitrary historical recovery remain CLI workflows. Unfinished, corrupt/future state and benchmark leases block recovery. |
| Project selection and distribution | Native folder chooser; Windows x64, Linux x64, macOS x64/arm64 artifacts. Hooks reference the installed runtime. | Fresh-install/update/recovery and post-close native integration recordings remain. Windows signing and macOS notarization are deferred. |

History uses `guided-operation-history.ts`, `/api/operations`, the `restore-latest`
preview and Results controls in `guided-product-client.ts`. The browser receives
fixed summaries, without paths, configuration contents or transaction selectors.
Tests reopen a service against retained journals and restore original configuration
bytes through the real engine using temporary directories and fake runners.

## Validation boundary

Native desktop CI builds and isolated packaged runtime/renderer/backend smoke
checks do not prove provider execution, hook use after close, upgrades/recovery or
savings. Linux Xvfb smoke does not cover all graphical/system-library combinations.
Windows is native; WSL remains a separate CLI environment. The published Windows
stack (#255), callbacks (#359) and paired measurements (#360) retain their own gates.

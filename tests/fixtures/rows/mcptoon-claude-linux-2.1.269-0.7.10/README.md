# mcptoon × Claude Code × Linux RFC 0009 recording

Recorded on 2026-09-13 by GitHub Actions run 34755964481 on an Ubuntu 24.04 Linux x64 hosted runner.

Exact observed combination:

- Claude Code: **2.1.269**
- mcptoon: **0.7.10**
- platform: **Linux, non-WSL, x64**
- Node.js: **22.13.1**
- verification tier: **config-only**

The recording used an isolated home and project. Brownfield state contained user-owned Claude settings and a separate user-owned skill. Managed apply created only the reviewed mcptoon skill path plus any missing parent directory. The transaction journal recorded the exact owned-file digest.

The drift stage modified the owned mcptoon SKILL.md and then attempted surgical uninstall. The production ownership guard refused removal and the edited file remained present. Verified rollback restored the complete pre-apply brownfield state. A second clean apply followed by surgical uninstall removed only the owned mcptoon SKILL.md while preserving user-owned settings and a user-owned skill, including changes made after apply.

invalidating-update.json is intentionally absent: no second real mcptoon or Claude Code version was installed merely to manufacture an invalidation state. The compatibility row must remain exact.

# Open-issue audit — October 9, 2026

Reviewed all four open issues against default-branch commit
`1166d8333adf2e9f3ab05c357254ab78dee78d62`, their acceptance criteria and retained
evidence. No open pull requests existed at the audit. None meets all closure criteria.

| Issue | Decision | Remaining acceptance work |
| --- | --- | --- |
| [#255 Windows stack](https://github.com/giuliastro/token-harness/issues/255) | Keep open. | October 4 local pre-release activity does not prove the upgraded published package or resolve/bound Windows Codex `workspace-write`. Requires native Windows recordings. |
| [#359 native routing](https://github.com/giuliastro/token-harness/issues/359) | Keep open. | Published 0.1.28 Linux callback/lifecycle coverage is complete with its Claude authentication limitation. Published-artifact Windows rechecks remain. |
| [#360 paired evidence](https://github.com/giuliastro/token-harness/issues/360) | Keep open. | Six-pair pilot retains passing code and negative results, but failed Codex stack execution, repetitions, isolated allowance and routing marginal-value comparisons remain. #378 supplies tooling, not these results. |
| [#379 desktop workflows](https://github.com/giuliastro/token-harness/issues/379) | Keep open; implement next slice. | #380 supplied packaging/connection smoke. RFC 0032 remains proposed and general benchmark workflows still require commands. This follow-up implements retained history and reviewed configuration recovery after reopen. Full native install/update/recovery evidence remains. |

This audit ran on native Linux. No new Windows execution or isolated benchmark
campaign was performed; earlier recordings retain their original versions and
scope. See the [desktop coverage matrix](../desktop-workflow-coverage.md).

# Codex 0.146.0 native routing contract

Reviewed October 4, 2026 against upstream tag `rust-v0.146.0`, commit
`be449751a978f02e5bbba886999662956c7f38f5`, and the installed Windows CLI reporting 0.146.0.

- [Tagged config parser](https://github.com/openai/codex/blob/rust-v0.146.0/codex-rs/config/src/hook_config.rs)
  declares `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, command handlers,
  `commandWindows`, integer `timeout`, and `additionalContextLimit`.
- [Tagged prompt input schema](https://github.com/openai/codex/blob/rust-v0.146.0/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json)
  declares the native event and prompt payload. Token Harness never retains prompt text.
- [Official hooks documentation](https://learn.chatgpt.com/docs/hooks) describes hook discovery
  and the independent trust review required for user hooks.

`packages/adapters/test/native-prompt-routing.test.ts` admits exactly 0.146.0 and rejects
0.145.0/0.146.1. `tests/integration/prompt-routing-apply.test.ts` exercises read-only planning,
stored-plan apply, preservation of existing hooks and byte-for-byte rollback on temporary files
with a fake runner. Neither fixture claims a runtime receipt or subscription savings.

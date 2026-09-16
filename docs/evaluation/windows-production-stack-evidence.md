# Real Windows production-stack evidence

This runbook supports issue #255. It collects the current Windows stack without installing, updating,
activating or exercising any provider automatically.

The target row is the real machine state, especially:

- RTK `0.49.0`;
- HarnessTrim `0.3.0`;
- the Claude Code and/or Codex versions actually installed;
- Token Harness `doctor`, `verify` and `stack-review` evidence before and after real qualifying use.

The collector is intentionally **not** a compatibility decision. A green collection does not admit a
managed-write row and does not prove the combined RTK + HarnessTrim stack by itself.

## Prepare current `main`

On the Windows machine used for the real validation:

```powershell
git checkout main
git pull
pnpm install --frozen-lockfile
pnpm build
```

The collector prefers the freshly built local `dist/bundle/token-harness.mjs`. If that bundle is not
present it falls back to `token-harness` from `PATH`.

## 1. Capture before evidence

```powershell
pwsh -File .\scripts\evaluation\windows-production-stack-evidence.ps1 -Phase before
```

The command writes a timestamped directory under
`artifacts/windows-production-stack-evidence/`. It captures:

- `rtk --version`;
- `harnesstrim --version`;
- `harnesstrim capabilities`;
- `claude --version` and `codex --version` when present;
- `token-harness doctor --verbose`;
- `token-harness verify --verbose`;
- `token-harness stack-review --json`;
- a `manifest.json` with command paths, arguments, exit codes and completeness.

The Windows profile path is replaced with `<USERPROFILE>` in captured command output and executable
paths. The collector does not dump environment variables or authentication data.

A non-zero exit after the files are written means the evidence is incomplete: inspect
`manifest.json`. RTK, HarnessTrim and the three Token Harness checks are required; at least one of
Claude Code or Codex must be present.

## 2. Exercise the real integrations

Use the installed coding agent normally and perform **real qualifying work** that should exercise each
provider:

- for RTK, a shell/tool operation whose output RTK actually handles;
- for HarnessTrim, a real reduction that HarnessTrim records.

Do not fabricate a receipt and do not use a synthetic result as live evidence. If one provider is not
actually exercised, record that as `not-exercised` rather than inferring success from installation or
configuration.

## 3. Capture after evidence

```powershell
pwsh -File .\scripts\evaluation\windows-production-stack-evidence.ps1 -Phase after
```

Keep the complete `before` and `after` directories together. Review the receipts and exact
provider/harness attribution before changing any compatibility registry or closing #255.

## Maintainer self-test

The collector has a Windows-only self-test that creates temporary fake commands, verifies all eight
receipts are captured, and checks `<USERPROFILE>` sanitization:

```powershell
pwsh -File .\scripts\evaluation\windows-production-stack-evidence.ps1 -SelfTest
```

CI runs this self-test on Windows. It is only a collector test and is never treated as the real
Windows evidence required by #255.

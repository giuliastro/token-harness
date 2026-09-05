# RTK 0.44.0 × Claude Code 2.1.251 on Windows

Recorded on GitHub Actions windows-latest on 2026-09-05 using an isolated home under C:\th-live-evidence.

The recording exercised the real executables and the real Token Harness transaction engine:

- empty and brownfield configuration capture;
- provisional managed apply;
- both Bash and PowerShell matchers written with tk hook claude;
- user drift after apply;
- verified whole-file rollback;
- a second apply followed by surgical uninstall, preserving the user-added hook;
- an invalidating provider update to RTK 0.48.0;
- a direct Claude native-hook payload with 	ool_name: PowerShell, which RTK rewrote successfully.

The brownfield and drift states are deterministic isolated test states, not copied from a developer home. No credentials or user configuration were present.

Direct PowerShell-hook output:

`json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecisionReason":"RTK auto-rewrite","updatedInput":{"command":"rtk git status"}}}
`

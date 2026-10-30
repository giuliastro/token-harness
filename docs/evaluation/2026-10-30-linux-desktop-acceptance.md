# Linux desktop acceptance evidence — October 30, 2026

The published v0.1.34 Linux x64 TAR.GZ SHA-256 was verified against its release
checksum file: `6f3a20977389fc96470e700240dea79aee63af696e46df596108adaf7dcceaaf`.
The extracted package's `--desktop-smoke` returned session 200, dashboard true,
privileged false and displayed version `0.1.34`.

With normal Electron launch under isolated HOME/XDG directories inside the user
home, the startup dashboard appeared and detected Codex `0.164.0-alpha.11.1`, RTK
`1.0.1` and HarnessTrim `0.3.1`. A `/tmp` state path was refused by the intended
safety guard; moving the isolated state under home allowed the launch. The UI
preview safely refused RTK, HarnessTrim and routing integration for the Codex
alpha. In the isolated copy, a UI-reviewed RTK update from `1.0.1` to `1.1.0`
re-read the active executable; `/home/giulio/.local/bin/rtk` remained `1.0.1`.

The v0.1.34 release UI showed a stale update banner after success. Main's later
#403 fix was not packaged or tested here. Full brownfield, undo/recovery and
after-close native integration checks remain untested, as do Windows, macOS and
Claude. This is partial Linux evidence and does not pass or close #379.

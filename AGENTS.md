# Token Harness contributor instructions

- Read `PLAN.md` and the accepted RFCs in `docs/rfcs/` before changing architecture.
- Keep provider-specific behavior behind the provider contract.
- Keep harness-specific paths and hook formats behind harness adapters.
- All mutations must support plan, apply, verification, and rollback.
- Dry-run is the default; never install third-party software during tests.
- Tests use temporary directories and fake process runners.
- Do not combine providers on an exclusive capability without a compatibility fixture.
- Never merge exact and estimated savings into one unlabeled total.
- Never present a config-only check as proof that the harness reaches the provider;
  state the verification tier.
- Keep Windows, macOS, Linux, and WSL behavior explicit. Windows is the primary
  development platform for the platform and state layers.
- Test platform invariants as properties, not as the call that is supposed to produce
  them. `fs.chmod` proves nothing on Windows.
- Exit codes, the `--json` envelope, and stream discipline are the public contract in
  RFC 0006. Human output is golden-compared too, not only JSON.
- Every adapter carries brownfield fixtures: the user already configured this tool by
  hand, and adoption must not overwrite their work.
- A provider supporting a harness that Token Harness does not manage is normal context,
  never a problem, and never something to modify.
- Extract a package when a consumer appears; do not pre-split.

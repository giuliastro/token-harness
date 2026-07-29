# Token Harness contributor instructions

- Read `PLAN.md` and the accepted RFCs in `docs/rfcs/` before changing architecture.
- Keep provider-specific behavior behind the provider contract.
- Keep harness-specific paths and hook formats behind harness adapters.
- All mutations must support plan, apply, verification, and rollback.
- Dry-run is the default; never install third-party software during tests.
- Tests use temporary directories and fake process runners.
- Do not combine providers on an exclusive capability without a compatibility fixture.
- Never merge exact and estimated savings into one unlabeled total.
- Keep Windows, macOS, Linux, and WSL behavior explicit.


# mcptoon selection campaign surface

Selection evidence for mcptoon is fail-closed to the compatibility surface that has actually been reviewed.

Current campaign admission permits only native Linux (`wsl: false`) with the Codex or Claude Code harness families. Windows, macOS, WSL and other harness families are rejected before `benchmark-matrix` can emit campaign steps and before a copied `benchmark-start` command can create a capture.

This guard does not widen compatibility by family name: promotion remains constrained to the exact reviewed compatibility rows and versions documented in `docs/candidates/mcptoon.md`. Evidence from an unreviewed platform or harness/version combination cannot close the mcptoon selection gate.

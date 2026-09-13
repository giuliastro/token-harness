# mcptoon selection campaign surface

Selection evidence for mcptoon is fail-closed to the compatibility surface that has actually been reviewed.

Current campaign admission permits only native Linux (`wsl: false`) on an exact reviewed harness row: Codex 0.152.1, Codex 0.153.0, or Claude Code 2.1.269. Windows, macOS, WSL, other harness families and different harness versions are rejected before `benchmark-matrix` can emit campaign steps and before a copied `benchmark-start` command can create a capture.

A baseline may be captured before mcptoon is enabled, but it still requires the exact reviewed harness/platform row. An optimized start additionally requires the exact reviewed mcptoon 0.7.10 binary. These checks use only local `--version` probes; they do not contact MCP servers or execute MCP tools.

This guard does not widen compatibility by family name. Evidence from an unreviewed platform, harness version or mcptoon version cannot close the mcptoon selection gate.

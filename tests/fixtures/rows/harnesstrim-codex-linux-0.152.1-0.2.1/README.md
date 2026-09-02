# `harnesstrim` × `codex` on Linux

Recorded 2026-09-02 on Zorin OS 18.1, Linux x64, no WSL, against an isolated home and isolated project. Codex 0.152.1, HarnessTrim 0.2.1.

The install is the reviewed skills-only invocation produced through Token Harness with a one-run provisional compatibility row. HarnessTrim writes only the reviewed Codex skill artifacts under `.codex/skills/`; `AGENTS.md` remains user-owned and untouched.

| Stage | Recorded | What it proves |
| --- | --- | --- |
| `empty` | yes | no declared Codex integration state present |
| `brownfield` | yes | user-owned `my-own-skill` and `AGENTS.md` exist before apply |
| `post-apply` | yes | HarnessTrim skills added while user-owned skill and `AGENTS.md` remain intact |
| `invalidating-update` | **no** | no second real provider/harness version was installed for an honest recording |
| `drift` | yes | user drift appended to an applied HarnessTrim skill |
| `rollback` | yes | HarnessTrim artifacts restored away; user-owned skill and `AGENTS.md` preserved |
| `uninstall` | yes | the seven Token Harness-owned HarnessTrim artifacts removed surgically; user-owned files preserved |

## Admission scope

This fixture is evidence only for the exact combination it recorded:

- platform: Linux, non-WSL;
- Codex: 0.152.1;
- HarnessTrim: 0.2.1;
- verification tier: `config-only`.

It must not be widened to nearby Codex or HarnessTrim versions by semver inference. A future version needs its own recorded evidence.

## Why `invalidating-update` is absent

An invalidating-update stage has to come from a real different installed provider or harness version. Synthesizing one would turn a compatibility fixture into a guess. The absence is therefore explicit, matching the existing reviewed row-fixture policy.

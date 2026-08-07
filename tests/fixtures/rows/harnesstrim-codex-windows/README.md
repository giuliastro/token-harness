# `harnesstrim` × `codex` on Windows

Recorded 2026-08-07 on Windows 11 (26200), no WSL, against an isolated home at
`C:/Software/th-cr-home`. Codex 0.146.0, HarnessTrim 0.1.0.

The install is the skills-only invocation: `harnesstrim install codex <project> --apply
--no-instructions`. Codex's hook is opt-in, so the invocation omits `--hook` rather than negating it,
and `.codex/hooks.json` and `AGENTS.md` are its protected paths — the two files the installer reports
skipping.

| Stage | Recorded | What it holds |
| --- | --- | --- |
| `empty` | yes | nothing configured |
| `brownfield` | yes | a user's own `my-own-skill` and their own `AGENTS.md` |
| `post-apply` | yes | applied over both; the seven reviewed skill artifacts added, the user's skill and `AGENTS.md` untouched |
| `invalidating-update` | **no** | only one HarnessTrim version is installed here |
| `drift` | yes | a line appended to an applied `SKILL.md` |
| `rollback` | yes | the seven gone, `my-own-skill` and `AGENTS.md` intact, the drift gone with them |
| `uninstall` | yes | seven actions applied; the only `SKILL.md` left is the user's |

## Why the digests are the Claude ones

The Codex install writes the same seven artifacts as the Claude invocation, byte for byte — same
files, different directory. `SKILL_ARTIFACT_DIGESTS` is therefore shared between the two reviews, and
what differs is the containment boundary and the protected paths. That is the whole reason
`delegatedInstallReviews` is keyed by harness: one review could describe only one of them, which is
why HarnessTrim planned nothing on Codex while its capability was assigned there.

## `invalidating-update` is missing, deliberately

The stage needs a provider version outside the one the row observed, and only one HarnessTrim version
is installed here. A recorded state is evidence; a synthesised one would assert something nobody
stood in.

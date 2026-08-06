# `harnesstrim` × `claude` on Windows

Recorded 2026-08-06 on Windows 11 (26200), no WSL, against an isolated home at
`C:/Software/th-r-home`. Claude Code 2.1.220, HarnessTrim 0.1.0.

The install is the skills-only invocation: `harnesstrim install claude <project> --apply --no-hook
--no-instructions`. `.claude/settings.json` and `CLAUDE.md` are its protected paths, named because
the installer must not create them.

| Stage | Recorded | What it holds |
| --- | --- | --- |
| `empty` | yes | nothing configured |
| `brownfield` | yes | a user's own `my-own-skill`, a hand-placed older `compact-handoff/SKILL.md`, and their own `CLAUDE.md` |
| `post-apply` | yes | applied over the user's own skill and `CLAUDE.md`, both untouched; the seven reviewed skill files added |
| `invalidating-update` | **no** | only one HarnessTrim version is installed here |
| `drift` | yes | a line appended to an applied `SKILL.md` |
| `rollback` | yes | the seven skill files gone, `my-own-skill` and `CLAUDE.md` intact, the drift gone with them |
| `uninstall` | **no** | see below |

## What the brownfield stage found

Applying over the hand-placed `compact-handoff/SKILL.md` **fails**, with
`delegated-install-artifact-mismatch` naming that path: the installer does not overwrite a file the
user already put there, so the reviewed artifact digest never matches. The transaction rolled back
and all nineteen snapshots were restored — the user's skill, their `CLAUDE.md`, and the older file
they had placed were all intact afterwards.

That is protective, and worth stating plainly because it is also a limitation: a user who copied a
HarnessTrim skill by hand cannot be migrated to the managed install without removing their copy
first. Nothing here overwrites it for them.

## `uninstall` is missing because it is gated

`uninstall` computes a plan, so the RFC 0009 gate refuses it exactly as it refuses `apply`: the run
reported `managed-mutation-blocked` for three combinations and removed nothing. The stage becomes
recordable once a row admits this combination — which is what these fixtures exist to support. The
`apply` stages got through only via the provisional row of `apply-with-provisional-row.mjs`, and that
tool drives `apply` alone.

Recording it from the blocked run would have filed the post-apply state under the uninstall name.

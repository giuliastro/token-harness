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
| `uninstall` | yes | the six reviewed `SKILL.md` files removed, the user's own skill kept |

## What the brownfield stage found

Applying over the hand-placed `compact-handoff/SKILL.md` **fails**, with
`delegated-install-artifact-mismatch` naming that path: the installer does not overwrite a file the
user already put there, so the reviewed artifact digest never matches. The transaction rolled back
and all nineteen snapshots were restored — the user's skill, their `CLAUDE.md`, and the older file
they had placed were all intact afterwards.

That is protective, and worth stating plainly because it is also a limitation: a user who copied a
HarnessTrim skill by hand cannot be migrated to the managed install without removing their copy
first. Nothing here overwrites it for them.

## What the uninstall stage found

Recorded after the row shipped, so `uninstall` ran from the plain CLI. Eight actions applied — the
`settings.json` entry and the seven HarnessTrim artifacts — and afterwards the only `SKILL.md` left
under `.claude/skills/` was the user's own. That is RFC 0004 §Ownership holding: removed only what it
owned.

Two things it does not do, neither of them a defect worth calling one. The seven skill *directories*
stay behind as empty shells, because the removal is per artifact and a directory is not one. And the
run still reports `managed-mutation-blocked` for `harnesstrim × codex` and `harnesstrim × opencode`:
`uninstall` computes a plan for every combination, so the two with no row are refused alongside the
one that succeeds. The transaction commits anyway and the exit code is 0, which is worth knowing
before reading those errors as a failure of the removal.

I misread this twice while recording it, both times by listing the skill directories instead of the
files inside them and concluding nothing had been removed.

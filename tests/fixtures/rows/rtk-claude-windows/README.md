# `rtk` × `claude` on Windows

Recorded 2026-08-06 on Windows 11 (26200), no WSL, against an isolated home at
`C:/Software/th-iso-home` so nothing here describes the operator's own configuration.

| Component | Version |
| --- | --- |
| Claude Code | 2.1.220 |
| RTK | 0.44.0 |

## Stages

| Stage | Recorded | What it holds |
| --- | --- | --- |
| `empty` | yes | nothing configured; zero of six declared locations present |
| `brownfield` | yes | a hand-written `settings.json`: the RTK hook plus a user's own `Write|Edit` and `PostToolUse` hooks and a `permissions.allow` entry |
| `post-apply` | yes | applied from a state holding the user's hooks but not RTK's. Apply added `PreToolUse`/`Bash`/`rtk hook claude` and left every user entry intact |
| `invalidating-update` | **no** | see below |
| `drift` | yes | a user hook appended beside the applied one, and a widened `permissions.allow` |
| `rollback` | yes | whole-file restore. The drift is gone, which is correct — `rollback --help` says the snapshot takes back anything changed since the apply |
| `uninstall` | yes | removed only the RTK entry; the user's hook survived |

## `invalidating-update` is missing, deliberately

The stage needs a provider version outside the one the row observed, and only one RTK version is
installed here. A recorded state is evidence; a synthesised one would be a fixture asserting
something nobody stood in. It stays missing until a machine has two versions to move between.

## Two findings from recording this

**`rollback` and `uninstall` are not interchangeable.** RFC 0009 asks for "rollback and uninstall
with user-owned entries preserved", and only `uninstall` preserves: `rollback` is whole-file time
travel and discards post-apply user edits by design. The recorder gained a separate `uninstall`
stage because filing one as the other would claim preservation for the command that does not
preserve.

**`uninstall` reports a removal it did not perform.** With user drift inside the entry it owns, it
declines to touch it — conservative and defensible — but the action reads `already-satisfied` and the
summary still says "Removed what Token Harness owned. Everything else is untouched." Verified both
ways here: without drift the entry is removed and the run reads `applied`; with drift the entry is
still present afterwards and the user is told it was removed. `already-satisfied` also means "already
in the desired state", which is false when the entry is still there.

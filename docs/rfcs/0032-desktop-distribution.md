# RFC 0032: Desktop application and release artifacts

- Status: Proposed — implementation included for review in #379
- Date: 2026-10-05

## Scope

Ship the existing RFC 0013 guided application in an Electron window, together with
native Windows, Linux and macOS packages on each release. This is the first desktop
milestone of #379; it does not claim complete CLI workflow parity or change provider
admission, verification tiers, measurements, the RFC 0010 external read-only seam,
or RFC 0006's CLI contracts. The CLI remains independently distributed through npm.

## Runtime and process boundary

Electron hosts the current local browser UI with Node integration disabled, context
isolation and sandboxing enabled, and no renderer IPC bridge. A plain Node executable
and the exact CLI package from the same source tree are shipped outside ASAR, under
resources/runtime and resources/backend. The native build copies its running Node
binary and upstream license; cross-compilation with a different runtime architecture
is refused. Electron and its Chromium notices also remain in the packaged application.

The desktop process starts that Node executable through the platform process boundary,
with an argument array, explicit project directory, filtered environment and IPC
readiness handshake. Only the validated loopback listener returned by that child can
be loaded in the window. Existing Host, Origin, CSRF, approval, ownership, backup and
transaction controls remain enforced by the backend. Other navigation is refused;
HTTPS links open in the system browser. No remote page gets desktop privileges.

The home directory is the initial project. A native folder chooser switches projects;
the interface cannot submit an arbitrary path or executable. Selecting a project
starts a replacement listener before retiring the old one. Normal shutdown closes
the HTTP listener and waits for in-flight work to finish, rather than terminating an
approved mutation. Losing the parent IPC connection also closes the listener.

Installed hooks reference the real Node executable and CLI bundle in the installed
application. They work after the window closes, without a running desktop supervisor.
Keep the installation at the same path when replacing a version. Moving or uninstalling
it requires reviewing/removing its owned integrations first. No providers or coding
agents are bundled. Their authentication and native hook trust remain their own.

## Platforms and artifacts

| Platform | Architecture | Artifacts | Installation |
| --- | --- | --- | --- |
| Windows | x64 | NSIS setup .exe | Per-user, stable installation directory |
| Linux | x64 | .deb and .tar.gz | Install package or retain extracted directory |
| macOS | x64 and arm64 | .dmg and .zip per architecture | Copy app to Applications |

AppImage and Windows portable/self-extracting executables are deferred: their temporary
resource paths cannot serve as durable hook executables. Windows builds use native
Windows runners; WSL remains a separate CLI environment and is never implicitly managed
by the Windows application. Linux requires a graphical session and Electron's system
libraries; macOS applications must be copied out of the mounted disk image before setup.

Initial Windows artifacts are unsigned and macOS artifacts are ad-hoc signed, without
notarization. They are explicitly documented as such; trusted production signing needs
maintainer certificates and a later credentialed release configuration. This PR does not
claim to satisfy that part of #379. App self-update is manual through GitHub Releases,
and packaged applications cannot trigger npm self-update. Existing CLI installations
share the current managed state/transaction controls without becoming desktop-owned.

## Release integration

A reusable read-only desktop build workflow builds and smoke-checks each native target.
It is called directly by the existing tag/manual-recovery release workflow. Do not rely
on a release event: events created with GITHUB_TOKEN may not trigger another workflow.
Desktop builds must pass before the existing npm publishing job runs. The release job
downloads the complete artifact set, checks exact tag/version/name coverage, generates
SHA-256 checksums, and uploads only those assets to the same existing GitHub release.
Recovery uses the same immutable tag and replaces identically named assets; it never
publishes the desktop artifacts to a different tag or creates a separate release.
Historical tags without the desktop application retain their original CLI-only recovery
path; the exact checked-out source determines this, rather than the current default branch.

Pull requests build the same packages and exercise the packaged backend and renderer,
without release-write permissions. Unit tests use fake process ports and temporary
directories; they download/install nothing. Packaged smoke checks are separate from
the unit suite and isolate HOME, configuration, state and project directories.

## Workflow coverage

| Workflow | First desktop milestone |
| --- | --- |
| Agent/optimizer diagnostics and tier-aware verification | Existing guided UI |
| Preview, approval, setup, maintenance and guarded undo | Existing guided UI |
| Supported preferences, skills and native routing | Existing guided UI |
| Recorded results and provenance | Existing guided UI |
| Project selection | Native folder chooser |
| App installation/distribution | Native release artifacts |
| Packaged app updates | Manual replacement from GitHub Releases |
| Advanced benchmark campaigns, scheduling, handoff and arbitrary history | Existing CLI; broader parity remains #379 work |

## Validation

Test readiness URL rejection, startup failure/timeout, environment filtering, graceful
stop and parent-disconnect cleanup. Verify runtime and CLI bytes/version/architecture,
license presence and artifact completeness. Each native build starts the packaged
backend and hidden Electron renderer in an isolated profile, reads the actual local
session endpoint and checks the dashboard loaded. This proves packaging and the UI
connection, not provider execution or subscription savings. Existing contract tests
and npm bundle/install smoke checks remain release gates.

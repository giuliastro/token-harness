from pathlib import Path

path = Path('packages/adapters/src/providers/mcptoon-managed.ts')
text = path.read_text()

old = """export const MCPTOON_MANAGED_MINIMUM_VERSION = '0.7.8';
export const MCPTOON_REVIEWED_INSTALL_VERSION = '0.7.10';
"""
new = """export const MCPTOON_REVIEWED_INSTALL_VERSION = '0.7.10';
/** Backwards-compatible alias. Managed admission is exact, not a semver floor. */
export const MCPTOON_MANAGED_MINIMUM_VERSION = MCPTOON_REVIEWED_INSTALL_VERSION;
"""
if old not in text:
    raise SystemExit('managed version anchor not found')
text = text.replace(old, new, 1)

old = """remediation: `Keep the existing installation user-owned, or move to mcptoon ${MCPTOON_MANAGED_MINIMUM_VERSION} or newer with the reviewed manifest surfaces`,"""
new = """remediation: `Keep the existing installation user-owned, or move to the exact reviewed mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION} build`,"""
if old not in text:
    raise SystemExit('managed remediation anchor not found')
text = text.replace(old, new, 1)

path.write_text(text)

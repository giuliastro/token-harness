from pathlib import Path

path = Path('packages/core/test/update-inputs.test.ts')
text = path.read_text()
old = "assert.deepEqual(knownPackageManagers(), ['cargo', 'npm', 'pnpm', 'winget']);"
new = "assert.deepEqual(knownPackageManagers(), ['cargo', 'npm', 'pipx', 'pnpm', 'winget']);"
if old not in text:
    raise SystemExit('knownPackageManagers invariant anchor changed')
path.write_text(text.replace(old, new, 1))

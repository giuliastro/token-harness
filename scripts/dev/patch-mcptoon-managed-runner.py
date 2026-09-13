from pathlib import Path

path = Path('packages/adapters/test/mcptoon-managed.test.ts')
text = path.read_text()
old = """      if (request.args[0] === 'manifest' && request.args[1] === '--help') {
        return Promise.resolve(outcome(request, 'Options: --compact --json --toon'));
      }
"""
new = """      if (request.args[0] === '--help') {
        return Promise.resolve(outcome(request, 'Options: --compact --json --toon'));
      }
"""
if old not in text:
    raise SystemExit('managed mcptoon runner help anchor changed')
path.write_text(text.replace(old, new, 1))

from pathlib import Path

path = Path('scripts/candidate-comparison-activation-temp.py')
text = path.read_text()
old = '/Local token\\\\/context evidence is not provider allowance/'
new = '/Local token\\\\/context evidence is not provider allowance/i'
if old not in text:
    raise SystemExit('decision-evidence regex anchor not found')
path.write_text(text.replace(old, new, 1))

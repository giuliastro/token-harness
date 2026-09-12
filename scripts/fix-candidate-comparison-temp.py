from pathlib import Path

path = Path('scripts/candidate-comparison-activation-temp.py')
text = path.read_text()
old = '''replace(
    path,
    "      /Local token\\\\/context evidence is not provider allowance/,\\n",
    "      /Local token\\\\/context evidence is not provider allowance/,\\n",
)
'''
new = '''replace(
    path,
    "      /Local token\\\\/context evidence is not provider allowance/,\\n",
    "      /Local token\\\\/context evidence is not provider allowance/i,\\n",
)
'''
if old not in text:
    raise SystemExit('temporary decision-evidence assertion block not found')
path.write_text(text.replace(old, new, 1))

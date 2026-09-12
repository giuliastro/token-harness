from pathlib import Path

path = Path('scripts/candidate-comparison-activation-temp.py')
text = path.read_text()
start = text.find('\nreplace(\n    path,\n    "      /Local token')
if start < 0:
    raise SystemExit('temporary no-op block start not found')
end = text.find('\n\n# README and roadmap docs:', start)
if end < 0:
    raise SystemExit('temporary no-op block end not found')
path.write_text(text[:start] + text[end:])

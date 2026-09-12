from pathlib import Path

path = Path('scripts/gitnexus-activation-patch-temp.py')
text = path.read_text()
start = text.index('path = "README.md"\n')
replacement = '''path = "README.md"
p = Path(path)
text = p.read_text()
needle = "the browser acknowledgement—as proof that the candidate was active."
if needle not in text:
    raise SystemExit("README activation sentence missing")
text = text.replace(
    needle,
    needle
    + " For GitNexus, new benchmark receipts can additionally verify activation from the "
    + "harness-native MCP inventory when the GitNexus server is observed usable at both task "
    + "boundaries; missing or ambiguous runtime evidence stays unverified.",
    1,
)
p.write_text(text)
'''
path.write_text(text[:start] + replacement)

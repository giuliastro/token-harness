from pathlib import Path

path = Path('apps/cli/test/guided-candidate-campaign-http.test.ts')
text = path.read_text()
old = "    hardRegressionPairs: 0,\n    nextStep:"
new = "    hardRegressionPairs: 0,\n    activationState: 'unreviewed',\n    activationVerifiedPairs: 0,\n    activationBlockedPairs: 0,\n    activationUnknownPairs: 0,\n    nextStep:"
if old not in text:
    raise SystemExit('HTTP campaign fixture anchor missing')
path.write_text(text.replace(old, new, 1))

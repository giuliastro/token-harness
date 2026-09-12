from pathlib import Path


def replace(path: str, old: str, new: str, message: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(message)
    target.write_text(text.replace(old, new, 1))


replace(
    'apps/cli/test/guided-candidate-campaign-http.test.ts',
    "    hardRegressionPairs: 0,\n    nextStep:",
    "    hardRegressionPairs: 0,\n    activationState: 'unreviewed',\n    activationVerifiedPairs: 0,\n    activationBlockedPairs: 0,\n    activationUnknownPairs: 0,\n    nextStep:",
    'HTTP campaign fixture anchor missing',
)

# The action tests build a campaign report manually. Keep that fixture aligned with the
# production report contract instead of weakening the production reader for an impossible shape.
replace(
    'apps/cli/test/guided-candidate-campaign-action.test.ts',
    "      assessment: {\n        signal: 'insufficient-evidence',",
    "      activation: {\n        candidateId: 'gitnexus',\n        state: 'unreviewed',\n        verifiedPairs: 0,\n        blockedPairs: 0,\n        unknownPairs: 0,\n        reason: 'no completed optimized task has runtime activation evidence yet',\n      },\n      assessment: {\n        signal: 'insufficient-evidence',",
    'campaign action fixture activation anchor missing',
)

# Runtime activation evidence is independent of the fresh local capability observation.
# When the campaign proves GitNexus usable at task boundaries, that one gate may pass even
# while benchmark-capability and category-fit correctly remain unreviewed.
replace(
    'apps/cli/test/guided-candidate-campaign-status.test.ts',
    "    assert.match(status.note, /decision-ready does not mean promotion-ready/);",
    "    assert.match(status.note, /[Dd]ecision-ready does not mean promotion-ready/);",
    'campaign status note assertion anchor missing',
)
replace(
    'apps/cli/test/guided-candidate-campaign-status.test.ts',
    "    assert.equal(status.promotionReadiness?.passedGateCount, 0);\n    assert.ok(status.promotionReadiness?.unreviewedGateIds.includes('benchmark-capability'));",
    "    assert.equal(status.promotionReadiness?.passedGateCount, 1);\n    assert.ok(status.promotionReadiness?.unreviewedGateIds.includes('benchmark-capability'));",
    'campaign status no-observation assertion anchor missing',
)

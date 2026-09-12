from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"missing replacement anchor in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


# Saved-campaign comparison: make activation a first-class fact rather than something inferred
# from an aggregate gate count.
path = "apps/cli/src/guided-candidate-comparison-client.ts"
replace(
    path,
    "  const signalLabel = value => ({\n    'insufficient-evidence': 'More evidence needed',\n    promising: 'Promising',\n    mixed: 'Mixed',\n    negative: 'Negative',\n    unavailable: 'Unavailable',\n  })[value] || String(value || 'Unavailable');\n",
    "  const signalLabel = value => ({\n    'insufficient-evidence': 'More evidence needed',\n    promising: 'Promising',\n    mixed: 'Mixed',\n    negative: 'Negative',\n    unavailable: 'Unavailable',\n  })[value] || String(value || 'Unavailable');\n\n  const activationLabel = data => {\n    const state = data.activationState === 'verified'\n      ? 'Verified'\n      : data.activationState === 'blocked'\n        ? 'Blocked'\n        : 'Not verified';\n    return state + ' · ' + String(Number(data.activationVerifiedPairs) || 0) + ' verified · ' +\n      String(Number(data.activationBlockedPairs) || 0) + ' blocked · ' +\n      String(Number(data.activationUnknownPairs) || 0) + ' unknown pair(s)';\n  };\n",
)
replace(
    path,
    "      node('span', 'Decision ready'),\n      node('strong', data.decisionReady ? 'Yes' : 'No'),\n      node('span', 'Promotion review'),",
    "      node('span', 'Decision ready'),\n      node('strong', data.decisionReady ? 'Yes' : 'No'),\n      node('span', 'Activation evidence'),\n      node('strong', activationLabel(data)),\n      node('span', 'Promotion review'),",
)
replace(
    path,
    "        'This row reports evidence for one candidate/harness campaign. Gate counts are not a score or a ranking.',",
    "        'This row reports evidence for one candidate/harness campaign. Activation is a separate observed fact; gate counts are not a score or a ranking.',",
)

# In-campaign decision evidence: show exactly the same bounded activation state/counts.
path = "apps/cli/src/guided-candidate-decision-evidence-client.ts"
replace(
    path,
    "  function deltaText(value, pairs) {\n    if (value === null || value === undefined || Number(pairs) < 1) return 'Not measured';\n    const numeric = Number(value);\n    const direction = numeric >= 0 ? ' lower' : ' higher';\n    return String(Math.abs(numeric)) + '%' + direction + ' across ' + String(pairs) + ' comparable pair(s)';\n  }\n",
    "  function deltaText(value, pairs) {\n    if (value === null || value === undefined || Number(pairs) < 1) return 'Not measured';\n    const numeric = Number(value);\n    const direction = numeric >= 0 ? ' lower' : ' higher';\n    return String(Math.abs(numeric)) + '%' + direction + ' across ' + String(pairs) + ' comparable pair(s)';\n  }\n\n  function activationText(data) {\n    const state = data.activationState === 'verified'\n      ? 'Verified'\n      : data.activationState === 'blocked'\n        ? 'Blocked'\n        : 'Not verified';\n    return state + ' · ' + String(Number(data.activationVerifiedPairs) || 0) + ' verified · ' +\n      String(Number(data.activationBlockedPairs) || 0) + ' blocked · ' +\n      String(Number(data.activationUnknownPairs) || 0) + ' unknown pair(s)';\n  }\n",
)
replace(
    path,
    "        'Benchmark evidence and current local capability are evaluated together. This is not a composite score, activation proof, or promotion recommendation.',",
    "        'Benchmark evidence and current local capability are evaluated together. Candidate attribution is not activation proof; bounded runtime activation evidence is shown separately when available. This is not a composite score or promotion recommendation.',",
)
replace(
    path,
    "    facts.append(\n      node('span', 'Evidence coverage'),",
    "    facts.append(\n      node('span', 'Activation evidence'),\n      node('strong', activationText(data)),\n      node('span', 'Evidence coverage'),",
)
replace(
    path,
    "        'Local token/context evidence is not provider allowance. Wall-clock is operational evidence, not subscription or API savings. Lifecycle and combined-stack gates remain explicit.',",
    "        'Activation evidence, local token/context evidence and wall-clock evidence remain separate. Local token/context evidence is not provider allowance; wall-clock is operational evidence, not subscription or API savings. Lifecycle and combined-stack gates remain explicit.',",
)

# Tests lock in the product semantics: activation is explicit but is not a score/ranking.
path = "apps/cli/test/guided-candidate-comparison-client.test.ts"
replace(
    path,
    "    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Next gate/);\n    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Gate counts are not a score or a ranking/);",
    "    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Next gate/);\n    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Activation evidence/);\n    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /activationVerifiedPairs/);\n    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /activationBlockedPairs/);\n    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /activationUnknownPairs/);\n    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Gate counts are not a score or a ranking/);",
)

path = "apps/cli/test/guided-candidate-decision-evidence-client.test.ts"
replace(
    path,
    "    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Next gate/);\n    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /passedGateCount/);",
    "    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Next gate/);\n    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Activation evidence/);\n    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /activationVerifiedPairs/);\n    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /activationBlockedPairs/);\n    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /activationUnknownPairs/);\n    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /passedGateCount/);",
)
replace(
    path,
    "      /Local token\\/context evidence is not provider allowance/,
",
    "      /Local token\\/context evidence is not provider allowance/,
",
)

# README and roadmap docs: the compare view now carries activation as a separate fact.
path = "README.md"
replace(
    path,
    "started. The comparison is loaded only on request, never creates a campaign, keeps candidate and\nharness ordering fixed, and reports progress, selection signal, decision readiness and promotion\ngates without producing a composite score or automatic winner.",
    "started. The comparison is loaded only on request, never creates a campaign, keeps candidate and\nharness ordering fixed, and reports progress, selection signal, decision readiness, bounded runtime\nactivation evidence when available, and promotion gates without producing a composite score or\nautomatic winner.",
)

path = "docs/optimizer-priorities.md"
replace(
    path,
    "shown on the candidate card. An explicit **Compare evaluation evidence** action can read only saved\ncandidate/harness campaigns and place their progress, selection signal, decision readiness and gate\nstate side by side. It is intentionally on-demand, does not create missing campaigns or trigger a\nsecond environment scan, and preserves fixed candidate/harness ordering instead of ranking by a\nsynthetic score.",
    "shown on the candidate card. An explicit **Compare evaluation evidence** action can read only saved\ncandidate/harness campaigns and place their progress, selection signal, decision readiness, bounded\nruntime activation evidence and gate state side by side. Activation remains a separate fact rather\nthan a score input. The comparison is intentionally on-demand, does not create missing campaigns or\ntrigger a second environment scan, and preserves fixed candidate/harness ordering instead of ranking\nby a synthetic score.",
)

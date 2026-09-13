from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}")
    file.write_text(text.replace(old, new, 1))


# Compatibility matrix: add a second exact Codex point, never a range.
path = "packages/core/src/domain/compatibility-rows.ts"
replace_once(
    path,
    """ * Windows supplied the first reviewed rows. Linux now has exact Codex 0.152.1 rows for HarnessTrim
 * 0.2.1 and mcptoon 0.7.10, plus an exact Claude Code 2.1.269 row for mcptoon 0.7.10. The mcptoon
""",
    """ * Windows supplied the first reviewed rows. Linux now has an exact Codex 0.152.1 row for HarnessTrim
 * 0.2.1, exact Codex 0.152.1 and 0.153.0 rows for mcptoon 0.7.10, plus an exact Claude Code
 * 2.1.269 row for mcptoon 0.7.10. The mcptoon
""",
)
replace_once(
    path,
    """    fixture: 'tests/fixtures/rows/mcptoon-codex-linux-0.152.1-0.7.10',
    verificationTier: 'config-only',
  },
];""",
    """    fixture: 'tests/fixtures/rows/mcptoon-codex-linux-0.152.1-0.7.10',
    verificationTier: 'config-only',
  },
  {
    harness: 'codex' as HarnessId,
    harnessVersion: { minimum: '0.153.0', maximum: '0.153.0' },
    provider: 'mcptoon' as ProviderId,
    providerVersion: '0.7.10',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Separate real Ubuntu/Linux recording for Codex 0.153.0. Keep this as an exact point: the
    // owned surface is still only the Token Harness AGENTS.md marker, with drift, rollback and
    // surgical uninstall recorded independently for this harness version.
    configSchema: 'codex-agents-md-marker-block',
    fixture: 'tests/fixtures/rows/mcptoon-codex-linux-0.153.0-0.7.10',
    verificationTier: 'config-only',
  },
];""",
)

# Core admission coverage for the newly recorded point and its fail-closed neighbours.
path = "packages/core/test/compatibility-rows.test.ts"
marker = "  it('ships the exact Linux Claude 2.1.269 / mcptoon 0.7.10 admission and nothing broader', () => {"
new_test = """  it('ships the exact Linux Codex 0.153.0 / mcptoon 0.7.10 admission without widening', () => {
    const exact = admitManagedMutation(COMPATIBILITY_ROWS, {
      provider: providerId('mcptoon'),
      providerVersion: '0.7.10',
      harness: harnessId('codex'),
      harnessVersion: '0.153.0',
      os: 'linux',
      wsl: false,
    });
    assert.equal(exact.state, 'admitted');
    if (exact.state === 'admitted') {
      assert.equal(exact.row.configSchema, 'codex-agents-md-marker-block');
      assert.equal(exact.row.fixture, 'tests/fixtures/rows/mcptoon-codex-linux-0.153.0-0.7.10');
      assert.equal(exact.row.verificationTier, 'config-only');
    }

    for (const variant of [
      { harnessVersion: '0.153.1', providerVersion: '0.7.10', os: 'linux', wsl: false },
      { harnessVersion: '0.153.0', providerVersion: '0.7.11', os: 'linux', wsl: false },
      { harnessVersion: '0.153.0', providerVersion: '0.7.10', os: 'linux', wsl: true },
      { harnessVersion: '0.153.0', providerVersion: '0.7.10', os: 'windows', wsl: false },
      { harnessVersion: '0.153.0', providerVersion: '0.7.10', os: 'macos', wsl: false },
    ] as const) {
      const outcome = admitManagedMutation(COMPATIBILITY_ROWS, {
        provider: providerId('mcptoon'),
        providerVersion: variant.providerVersion,
        harness: harnessId('codex'),
        harnessVersion: variant.harnessVersion,
        os: variant.os,
        wsl: variant.wsl,
      });
      assert.equal(outcome.state, 'refused');
    }
  });

"""
replace_once(path, marker, new_test + marker)

# Campaign gate coverage: 0.153.0 becomes exact-reviewed, 0.153.1 remains refused.
path = "apps/cli/test/mcptoon-campaign-version-admission.test.ts"
replace_once(
    path,
    """  it('rejects a newer unreviewed harness version', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.153.0' }),
      false,
    );
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-row-unreviewed');
  });
""",
    """  it('admits the separately reviewed Codex 0.153.0 row', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.153.0' }),
      false,
    );
    assert.equal(diagnostic, null);
  });

  it('still rejects an unreviewed harness version above the new row', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.153.1' }),
      false,
    );
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-row-unreviewed');
  });
""",
)
replace_once(
    path,
    "context({ harness: 'codex', harnessVersion: '0.152.1', mcptoonVersion: '0.8.0' })",
    "context({ harness: 'codex', harnessVersion: '0.153.0', mcptoonVersion: '0.8.0' })",
)
replace_once(
    path,
    "context({ harness: 'codex', harnessVersion: '0.152.1', mcptoonVersion: '0.7.10' })",
    "context({ harness: 'codex', harnessVersion: '0.153.0', mcptoonVersion: '0.7.10' })",
)

replace_once(
    "docs/candidates/mcptoon-selection-surface.md",
    "Current campaign admission permits only native Linux (`wsl: false`) on an exact reviewed harness row: Codex 0.152.1 or Claude Code 2.1.269. Windows, macOS, WSL, other harness families and different harness versions are rejected before `benchmark-matrix` can emit campaign steps and before a copied `benchmark-start` command can create a capture.",
    "Current campaign admission permits only native Linux (`wsl: false`) on an exact reviewed harness row: Codex 0.152.1, Codex 0.153.0, or Claude Code 2.1.269. Windows, macOS, WSL, other harness families and different harness versions are rejected before `benchmark-matrix` can emit campaign steps and before a copied `benchmark-start` command can create a capture.",
)

replace_once(
    "docs/development-status.md",
    "- mcptoon selection campaigns now fail closed outside the exact reviewed native-Linux rows: Codex 0.152.1 or Claude Code 2.1.269. Optimized starts additionally require mcptoon 0.7.10; Windows, macOS, WSL, different harness versions and other harness families cannot create selection evidence.",
    "- mcptoon selection campaigns now fail closed outside the exact reviewed native-Linux rows: Codex 0.152.1, Codex 0.153.0, or Claude Code 2.1.269. The Codex 0.153.0 point has its own real Ubuntu compatibility/reversibility recording; it is not a widened semver range. Optimized starts additionally require mcptoon 0.7.10; Windows, macOS, WSL, different harness versions and other harness families cannot create selection evidence.",
)

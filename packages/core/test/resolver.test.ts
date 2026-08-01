/**
 * The static capability resolver — PLAN §9 acceptance, RFC 0003.
 *
 * PLAN's six criteria, each with tests below:
 *
 * - property tests ensure at most one owner for every exclusive scope;
 * - missing compatibility data fails closed;
 * - plan output explains every provider selection and rejection;
 * - changing provider order changes the pipeline ID;
 * - a hook added by hand after apply is detected;
 * - `balanced` is absent rather than aliased to `safe`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPATIBILITY_RULES,
  MANIFEST_SCHEMA_VERSION,
  PROFILE_IDS,
  derivePipelineId,
  detectUnownedEntries,
  formatCapabilityScope,
  harnessId,
  isProfileId,
  providerId,
  resolveOwnership,
  toReportedDrift,
  type CapabilityDeclaration,
  type CapabilityId,
  type CompatibilityRule,
  type HarnessConfigSummary,
  type HarnessManifest,
  type ResolvedCapability,
  type ResolverProvider,
} from '../src/index.js';

const CLAUDE = harnessId('claude');
const RTK = providerId('rtk');
const HARNESSTRIM = providerId('harnesstrim');

/** Claude's real surfaces, so a scope in a test is a scope that exists. */
const CLAUDE_MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: CLAUDE,
  displayName: 'Claude Code',
  homepage: 'https://claude.com/claude-code',
  testedVersions: { minimum: '2.0.0', maximum: '2.1.212' },
  verificationTier: 'canary',
  versionCommand: { executable: 'claude', args: ['--version'] },
  interceptionPoints: [
    { scopeId: 'pre-tool-use', eventName: 'PreToolUse' },
    { scopeId: 'post-tool-use', eventName: 'PostToolUse' },
  ],
  configFiles: [{ path: '.claude/settings.json', scope: 'user', parser: 'json', primary: true }],
  toolFamilies: [
    { id: 'Bash', platforms: ['windows', 'macos', 'linux'], executesShellCommands: true },
    { id: 'PowerShell', platforms: ['windows'], executesShellCommands: true },
  ],
  requiresEnablement: false,
  enablementNote: null,
  receiptFamily: 'provider-telemetry',
};

function declaration(overrides: {
  capability: CapabilityId;
  mode?: CapabilityDeclaration['mode'];
  toolFamily?: string;
  point?: string;
  evidence?: CapabilityDeclaration['evidence'];
}): CapabilityDeclaration {
  return {
    capability: overrides.capability,
    mode: overrides.mode ?? 'exclusive',
    harnesses: [CLAUDE],
    surfaces: [
      {
        toolFamily: overrides.toolFamily ?? 'Bash',
        interceptionPoint: overrides.point ?? 'pre-tool-use',
      },
    ],
    evidence:
      overrides.evidence === undefined
        ? { sourceReference: 'docs/spikes/2.5-live-verification-log.md', upstreamVersion: '0.42.0' }
        : overrides.evidence,
  };
}

function provider(
  id: ResolverProvider['id'],
  capabilities: CapabilityDeclaration[],
  assignable = true,
): ResolverProvider {
  return { id, capabilities, assignable };
}

/**
 * `observedVersions` matches what the rules below record, so a test about *ownership* is not
 * silently also a test about version staleness. The staleness behaviour has its own describe
 * block, where the versions are the variable under test.
 */
const BASE = {
  harnesses: [CLAUDE_MANIFEST],
  rules: [] as CompatibilityRule[],
  observedVersions: { rtk: '0.42.0', harnesstrim: '0.0.5' } as Record<string, string | null>,
};

describe('a single claimant', () => {
  it('owns the scope it declared, and only that scope', () => {
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [provider(RTK, [declaration({ capability: 'shell.output.reduce' })])],
    });

    assert.deepEqual(
      result.ownership.map((entry) => formatCapabilityScope(entry.scope)),
      ['claude/Bash/pre-tool-use/shell.output.reduce'],
    );
    assert.deepEqual(result.conflicts, []);
  });

  it('is given no scope on a surface it did not claim', () => {
    // RTK's manifest deliberately omits `PowerShell`: the Phase 2.5 spike ran the identical
    // command through it and RTK's counter did not move. A resolver that spread a claim over
    // every tool family would hand it a scope it does not serve.
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [provider(RTK, [declaration({ capability: 'shell.output.reduce' })])],
    });
    assert.equal(
      result.ownership.some((entry) => entry.scope.toolFamily === 'PowerShell'),
      false,
    );
  });

  it('spreads a wildcard claim across every family the harness exposes', () => {
    // HarnessTrim's OpenCode plugin is the real case: it reduces every tool result and
    // `input.tool` is never used as a filter.
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [
        provider(HARNESSTRIM, [declaration({ capability: 'tool.output.reduce', toolFamily: '*' })]),
      ],
    });
    assert.deepEqual(result.ownership.map((entry) => entry.scope.toolFamily).sort(), [
      'Bash',
      'PowerShell',
    ]);
  });
});

describe('the two gates', () => {
  it('rejects an unevidenced declaration rather than treating it as a weaker claim', () => {
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [
        provider(RTK, [declaration({ capability: 'shell.output.reduce', evidence: null })]),
      ],
    });

    // RFC 0003 §Rule: "An assignment the provider cannot implement there is a planning error,
    // not a configuration to attempt."
    assert.deepEqual(result.ownership, []);
    assert.equal(result.exclusions.length, 1);
    assert.match(result.exclusions[0]?.reason.join(' ') ?? '', /without evidence/);
  });

  it('rejects a capability no installer state can produce', () => {
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [
        provider(HARNESSTRIM, [declaration({ capability: 'shell.output.reduce' })], false),
      ],
    });

    assert.deepEqual(result.ownership, []);
    // RFC 0003 §Resolution at 0.1.0: HarnessTrim "is not installed by Token Harness at all",
    // but is still detected, adopted, reconciled, and measured — so the exclusion says so.
    assert.match(result.exclusions[0]?.reason.join(' ') ?? '', /cannot be asked for/);
    assert.match(result.exclusions[0]?.reason.join(' ') ?? '', /adopted/);
  });
});

describe('fail-closed on undeclared overlap', () => {
  const contenders = [
    provider(RTK, [declaration({ capability: 'shell.output.reduce' })]),
    provider(HARNESSTRIM, [declaration({ capability: 'shell.output.reduce' })]),
  ];

  it('is a hard conflict when no rule names the pair', () => {
    const result = resolveOwnership({ ...BASE, profile: 'safe', providers: contenders });

    // RFC 0003: "No rule means conservative conflict for overlapping exclusive capabilities."
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]?.code, 'exclusive-scope-contested');
    assert.deepEqual(result.conflicts[0]?.claimants, [RTK, HARNESSTRIM]);
    // And nobody owns it. A conflict that still assigned an owner would be a warning.
    assert.deepEqual(result.ownership, []);
  });

  /**
   * RFC 0004 §Amended: "Major" is the wrong test, and nothing performs even that one.
   *
   * These are the only tests that reach the staleness path, and that is the point: the shipped
   * `safe` profile does not reach it, because HarnessTrim is not assignable and `custom` has no CLI
   * surface. The rule's recorded versions went stale on disk anyway — `harnesstrim 0.0.5` recorded
   * against `0.0.6` installed — so the first caller to arrive would have consulted a result whose
   * validity nobody had checked.
   */
  describe('a rule outside the versions it records', () => {
    it('is withdrawn, and the reason names both versions', () => {
      const result = resolveOwnership({
        ...BASE,
        profile: 'safe',
        providers: contenders,
        rules: [...COMPATIBILITY_RULES],
        // The live case: the shipped rule records 0.0.5.
        observedVersions: { rtk: '0.42.0', harnesstrim: '0.0.6' },
      });

      const conflict = result.conflicts[0];
      assert.equal(conflict?.code, 'compatibility-rule-stale');
      // Both sides of the comparison, because "stale" without the numbers is not actionable.
      assert.ok(conflict?.detail.some((line) => line.includes('harnesstrim 0.0.5')));
      assert.ok(conflict?.detail.some((line) => line.includes('harnesstrim 0.0.6')));
      assert.deepEqual(result.ownership, []);
    });

    it('produces the conservative conflict rather than a fourth outcome', () => {
      // The withdrawal reuses RFC 0003's fail-closed path: nobody owns a scope whose rule cannot
      // be trusted, exactly as when no rule names the pair at all.
      const stale = resolveOwnership({
        ...BASE,
        profile: 'safe',
        providers: contenders,
        rules: [...COMPATIBILITY_RULES],
        observedVersions: { rtk: '0.42.0', harnesstrim: '0.0.6' },
      });
      const missing = resolveOwnership({ ...BASE, profile: 'safe', providers: contenders });
      assert.deepEqual(stale.ownership, missing.ownership);
      assert.equal(stale.conflicts.length, missing.conflicts.length);
    });

    it('treats a version it could not establish as not covered', () => {
      // An unknown version cannot be inside a tested range. Reading it as inside would be the
      // assumption the check exists to remove.
      const result = resolveOwnership({
        ...BASE,
        profile: 'safe',
        providers: contenders,
        rules: [...COMPATIBILITY_RULES],
        observedVersions: { rtk: '0.42.0', harnesstrim: null },
      });
      assert.equal(result.conflicts[0]?.code, 'compatibility-rule-stale');
      assert.ok(result.conflicts[0]?.detail.some((line) => line.includes('unknown')));
    });

    it('still applies a rule whose recorded versions match', () => {
      // The control. Without it the three tests above would also pass if the check rejected
      // everything, and a resolver that never applies a rule is not fail-closed but broken.
      const result = resolveOwnership({
        ...BASE,
        profile: 'safe',
        providers: contenders,
        rules: [...COMPATIBILITY_RULES],
        observedVersions: { rtk: '0.42.0', harnesstrim: '0.0.5' },
      });
      assert.equal(result.conflicts[0]?.code, 'exclusive-scope-incompatible');
    });

    it('allows a later patch at or above 1.0.0 but not a later major', () => {
      const rule: CompatibilityRule = {
        id: 'stable-pair',
        providers: [RTK, HARNESSTRIM],
        harnesses: '*',
        capabilities: ['shell.output.reduce'],
        outcome: 'conflict',
        testedVersions: { rtk: '1.2.0', harnesstrim: '1.0.0' },
        rationale: 'test',
        fixtures: ['fixture'],
      };
      // Same major: semver promises compatibility, so the rule stands.
      const within = resolveOwnership({
        ...BASE,
        profile: 'safe',
        providers: contenders,
        rules: [rule],
        observedVersions: { rtk: '1.9.3', harnesstrim: '1.0.0' },
      });
      assert.equal(within.conflicts[0]?.code, 'exclusive-scope-incompatible');

      const beyond = resolveOwnership({
        ...BASE,
        profile: 'safe',
        providers: contenders,
        rules: [rule],
        observedVersions: { rtk: '2.0.0', harnesstrim: '1.0.0' },
      });
      assert.equal(beyond.conflicts[0]?.code, 'compatibility-rule-stale');
    });
  });

  it('offers no force flag in the remediation', () => {
    const result = resolveOwnership({ ...BASE, profile: 'safe', providers: contenders });
    const remediation = result.conflicts[0]?.remediation ?? '';
    // RFC 0003 §Profiles: "An unsafe overlap requires a named compatibility rule, never a
    // generic force flag."
    assert.doesNotMatch(remediation, /--force|force flag|override/i);
    assert.match(remediation, /compatibility rule/);
  });

  it('reports a named incompatibility with its rationale', () => {
    // The shipped table records the RTK/HarnessTrim overlap explicitly, so the user learns it
    // is a measured property of HarnessTrim 0.0.5 rather than missing data.
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: contenders,
      rules: [...COMPATIBILITY_RULES],
    });

    assert.equal(result.conflicts[0]?.code, 'exclusive-scope-incompatible');
    assert.match(result.conflicts[0]?.detail.join(' ') ?? '', /HarnessTrim 0\.0\.5/);
    assert.deepEqual(result.ownership, []);
  });

  it('treats an ordered rule with no order as unresolved rather than guessing', () => {
    const malformed: CompatibilityRule = {
      id: 'malformed',
      providers: [RTK, HARNESSTRIM],
      harnesses: '*',
      capabilities: ['shell.output.reduce'],
      outcome: 'ordered',
      testedVersions: {},
      rationale: 'test',
      fixtures: [],
    };
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: contenders,
      rules: [malformed],
    });

    assert.equal(result.conflicts[0]?.code, 'compatibility-rule-malformed');
    assert.deepEqual(result.ownership, []);
  });

  it('runs an ordered chain in the order the rule names', () => {
    const ordered: CompatibilityRule = {
      id: 'dedup-then-reduce',
      providers: [RTK, HARNESSTRIM],
      harnesses: '*',
      capabilities: ['shell.output.reduce'],
      outcome: 'ordered',
      order: [HARNESSTRIM, RTK],
      testedVersions: { rtk: '0.42.0', harnesstrim: '0.0.5' },
      rationale: 'fixture',
      fixtures: ['fixture'],
    };
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: contenders,
      rules: [ordered],
    });

    assert.deepEqual(
      result.ownership.map((entry) => [entry.owner, entry.order]),
      [
        [HARNESSTRIM, 0],
        [RTK, 1],
      ],
    );
  });

  it('does not arbitrate observers at all', () => {
    const observers = [
      provider(RTK, [declaration({ capability: 'metrics.observe', mode: 'observational' })]),
      provider(HARNESSTRIM, [
        declaration({ capability: 'metrics.observe', mode: 'observational' }),
      ]),
    ];
    const result = resolveOwnership({ ...BASE, profile: 'safe', providers: observers });

    // RFC 0003 §Observational capabilities are outside this model. Two observers are not in
    // conflict — an observer transforms no payload — and the address the resolver works over
    // names an interception point that observation does not have. Assigning them would imply a
    // safety property that actually comes from RFC 0005's deduplication keys.
    assert.deepEqual(result.ownership, []);
    assert.deepEqual(result.conflicts, []);
    // And no exclusion: nothing was excluded, because nothing was ever a candidate.
    assert.deepEqual(result.exclusions, []);
  });

  it('still resolves a transforming capability declared beside an observational one', () => {
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [
        provider(RTK, [
          declaration({ capability: 'metrics.observe', mode: 'observational' }),
          declaration({ capability: 'shell.output.reduce' }),
        ]),
      ],
    });
    // The exclusion is per declaration, not per provider: a provider that observes and also
    // transforms still owns what it transforms.
    assert.deepEqual(
      result.ownership.map((entry) => entry.scope.capability),
      ['shell.output.reduce'],
    );
  });
});

describe('at most one owner for every exclusive scope', () => {
  /**
   * The property PLAN §9 asks for.
   *
   * Generated rather than enumerated, and deterministically: the seed is the case index, so a
   * failure is reproducible and the suite does not pass or fail differently between runs.
   */
  it('holds across generated provider sets', () => {
    const capabilities: CapabilityId[] = [
      'shell.output.reduce',
      'shell.command.rewrite',
      'tool.output.reduce',
      'metrics.observe',
    ];
    const families = ['Bash', 'PowerShell', '*'];
    const points = ['pre-tool-use', 'post-tool-use'];
    const ids = [RTK, HARNESSTRIM, providerId('dejavu')];

    for (let seed = 0; seed < 600; seed += 1) {
      let state = seed * 2654435761 + 1;
      const next = (bound: number): number => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state % bound;
      };

      const providers: ResolverProvider[] = ids.slice(0, 1 + next(ids.length)).map((id) => {
        const count = 1 + next(capabilities.length);
        const declarations: CapabilityDeclaration[] = [];
        for (let index = 0; index < count; index += 1) {
          const capability = capabilities[next(capabilities.length)] as CapabilityId;
          if (declarations.some((entry) => entry.capability === capability)) continue;
          declarations.push(
            declaration({
              capability,
              mode: capability === 'metrics.observe' ? 'observational' : 'exclusive',
              toolFamily: families[next(families.length)] as string,
              point: points[next(points.length)] as string,
              ...(next(6) === 0 ? { evidence: null } : {}),
            }),
          );
        }
        return provider(id, declarations, next(5) !== 0);
      });

      const rules: CompatibilityRule[] = next(3) === 0 ? [...COMPATIBILITY_RULES] : [];
      const result = resolveOwnership({ ...BASE, profile: 'safe', providers, rules });

      const exclusiveOwners = new Map<string, number>();
      for (const entry of result.ownership) {
        if (entry.mode !== 'exclusive') continue;
        const key = formatCapabilityScope(entry.scope);
        exclusiveOwners.set(key, (exclusiveOwners.get(key) ?? 0) + 1);
      }
      for (const [scope, count] of exclusiveOwners) {
        assert.equal(count, 1, `seed ${String(seed)}: ${scope} has ${String(count)} owners`);
      }
    }
  });

  it('never resolves an owner for a scope it also reports as conflicted', () => {
    const contenders = [
      provider(RTK, [declaration({ capability: 'shell.output.reduce' })]),
      provider(HARNESSTRIM, [declaration({ capability: 'shell.output.reduce' })]),
    ];
    const result = resolveOwnership({ ...BASE, profile: 'safe', providers: contenders });
    const conflicted = new Set(result.conflicts.map((entry) => entry.scope));
    for (const entry of result.ownership) {
      assert.equal(conflicted.has(formatCapabilityScope(entry.scope)), false);
    }
  });
});

describe('every selection and rejection is explained', () => {
  it('gives each exclusion at least one reason', () => {
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [
        provider(RTK, [declaration({ capability: 'shell.output.reduce', evidence: null })]),
        provider(HARNESSTRIM, [declaration({ capability: 'tool.output.reduce' })], false),
      ],
    });

    assert.ok(result.exclusions.length > 0);
    for (const exclusion of result.exclusions) {
      assert.ok(exclusion.reason.length > 0, `${exclusion.excluded} excluded with no reason`);
      for (const line of exclusion.reason) assert.notEqual(line.trim(), '');
    }
  });

  it('accounts for every claiming provider as owner, exclusion, or conflict', () => {
    // The property behind PLAN's wording: a provider that claimed a scope and does not appear
    // anywhere in the result was dropped silently, which is the one outcome a plan may not
    // have.
    const providers = [
      provider(RTK, [declaration({ capability: 'shell.output.reduce' })]),
      provider(HARNESSTRIM, [declaration({ capability: 'shell.output.reduce' })], false),
      provider(providerId('dejavu'), [
        declaration({ capability: 'shell.output.deduplicate', mode: 'chainable' }),
      ]),
    ];
    const result = resolveOwnership({ ...BASE, profile: 'safe', providers });

    const accounted = new Set<string>([
      ...result.ownership.map((entry) => entry.owner),
      ...result.exclusions.map((entry) => entry.excluded),
      ...result.conflicts.flatMap((entry) => entry.claimants),
    ]);
    for (const entry of providers) {
      assert.ok(accounted.has(entry.id), `${entry.id} is unaccounted for`);
    }
  });

  it('names the retained provider on an exclusion decided by a rule', () => {
    const compatible: CompatibilityRule = {
      id: 'rtk-wins',
      providers: [RTK, HARNESSTRIM],
      harnesses: '*',
      capabilities: ['shell.output.reduce'],
      outcome: 'compatible',
      testedVersions: { rtk: '0.42.0', harnesstrim: '0.0.5' },
      rationale: 'RTK owns shell reduction under safe',
      fixtures: ['fixture'],
    };
    const result = resolveOwnership({
      ...BASE,
      profile: 'safe',
      providers: [
        provider(RTK, [declaration({ capability: 'shell.output.reduce' })]),
        provider(HARNESSTRIM, [declaration({ capability: 'shell.output.reduce' })]),
      ],
      rules: [compatible],
    });

    assert.equal(result.ownership[0]?.owner, RTK);
    assert.equal(result.exclusions[0]?.excluded, HARNESSTRIM);
    assert.equal(result.exclusions[0]?.retained, RTK);
  });
});

describe('profiles', () => {
  it('ships safe and custom, and not balanced', () => {
    // RFC 0003: "`balanced` is not shipped, because a profile identical to `safe` is a promise
    // with no content."
    assert.deepEqual([...PROFILE_IDS], ['safe', 'custom']);
    assert.equal(isProfileId('balanced'), false);
  });

  it('honours an explicit custom assignment', () => {
    const providers = [
      provider(RTK, [declaration({ capability: 'shell.output.reduce' })]),
      provider(HARNESSTRIM, [declaration({ capability: 'shell.output.reduce' })]),
    ];
    const result = resolveOwnership({
      ...BASE,
      profile: 'custom',
      providers,
      assignments: [{ provider: HARNESSTRIM, owns: ['shell.output.reduce'] }],
    });

    // RFC 0003: under `custom` a user "may invert the assignment", and that state is
    // producible because it is HarnessTrim's own installer default. No conflict, because only
    // one provider was assigned the scope.
    assert.equal(result.ownership.length, 1);
    assert.equal(result.ownership[0]?.owner, HARNESSTRIM);
    assert.deepEqual(result.conflicts, []);
  });

  it('assigns nothing under custom when nothing was assigned', () => {
    const result = resolveOwnership({
      ...BASE,
      profile: 'custom',
      providers: [provider(RTK, [declaration({ capability: 'shell.output.reduce' })])],
      assignments: [],
    });
    assert.deepEqual(result.ownership, []);
    assert.match(result.exclusions[0]?.reason.join(' ') ?? '', /custom profile does not assign/);
  });
});

describe('the pipeline id', () => {
  function ownershipOf(owners: readonly string[]): ResolvedCapability[] {
    return owners.map((owner, index) => ({
      scope: {
        harness: CLAUDE,
        toolFamily: 'Bash',
        interceptionPoint: 'pre-tool-use',
        capability: 'shell.output.reduce' as CapabilityId,
      },
      owner: providerId(owner),
      mode: 'chainable' as const,
      order: index,
    }));
  }

  it('changes when the provider order changes', () => {
    // PLAN §9 acceptance. Two installations running the same providers in a different order
    // are different pipelines producing differently attributable savings; one identifier for
    // both would merge their metrics silently.
    const forward = derivePipelineId(ownershipOf(['rtk', 'harnesstrim']));
    const reversed = derivePipelineId(ownershipOf(['harnesstrim', 'rtk']));
    assert.notEqual(forward, reversed);
  });

  it('is stable for the same ordered list', () => {
    assert.equal(
      derivePipelineId(ownershipOf(['rtk', 'harnesstrim'])),
      derivePipelineId(ownershipOf(['rtk', 'harnesstrim'])),
    );
  });

  it('changes when a provider moves to a different scope', () => {
    const onBash = derivePipelineId(ownershipOf(['rtk']));
    const onPowerShell = derivePipelineId([
      {
        scope: {
          harness: CLAUDE,
          toolFamily: 'PowerShell',
          interceptionPoint: 'pre-tool-use',
          capability: 'shell.output.reduce',
        },
        owner: RTK,
        mode: 'exclusive',
        order: 0,
      },
    ]);
    assert.notEqual(onBash, onPowerShell);
  });

  it('is null when nothing was resolved', () => {
    // A pipeline with no owners is not a pipeline, and an identifier for it would appear in
    // metrics as though it were one.
    assert.equal(derivePipelineId([]), null);
    assert.equal(resolveOwnership({ ...BASE, profile: 'safe', providers: [] }).pipelineId, null);
  });
});

describe('a hook added by hand afterwards', () => {
  const OWNERSHIP: ResolvedCapability[] = [
    {
      scope: {
        harness: CLAUDE,
        toolFamily: 'Bash',
        interceptionPoint: 'pre-tool-use',
        capability: 'shell.output.reduce',
      },
      owner: RTK,
      mode: 'exclusive',
      order: 0,
    },
  ];

  function config(commands: string[]): HarnessConfigSummary {
    return {
      harnessId: CLAUDE,
      configPath: 'C:\\Users\\dev\\.claude\\settings.json',
      scope: 'user',
      interceptionPoints: ['pre-tool-use'],
      matchers: ['Bash'],
      commands,
    };
  }

  const identify = (command: string): typeof RTK | typeof HARNESSTRIM | null =>
    /\brtk\b/i.test(command) ? RTK : /harnesstrim/i.test(command) ? HARNESSTRIM : null;

  it('is detected on an exclusive scope', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude', 'harnesstrim hook claude'])],
      identify,
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.code, 'unowned-entry-on-exclusive-scope');
  });

  it('reports the file, the surface, and the competing command', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude', 'harnesstrim hook claude'])],
      identify,
    });

    // The three things RFC 0003 §Continuous conflict detection names.
    assert.equal(findings[0]?.configPath, 'C:\\Users\\dev\\.claude\\settings.json');
    assert.equal(findings[0]?.matcher, 'Bash');
    assert.equal(findings[0]?.command, 'harnesstrim hook claude');
    assert.equal(findings[0]?.expectedOwner, RTK);
  });

  it('explains why a second hook matters', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude', 'harnesstrim hook claude'])],
      identify,
    });
    // The mechanism, not just the fact: the harness runs every matching hook.
    assert.match(findings[0]?.detail.join(' ') ?? '', /every matching hook/);
  });

  it('never proposes removing a third party entry', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude', 'harnesstrim hook claude'])],
      identify,
    });
    // RFC 0003: "Token Harness reports it and never silently removes a third party's entry."
    assert.match(findings[0]?.remediation ?? '', /will not remove/);
  });

  it('says nothing when the only entry is the owner', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude'])],
      identify,
    });
    assert.deepEqual(findings, []);
  });

  it('says nothing about a scope nobody owns', () => {
    // A machine where the user wired their own tools and asked Token Harness for nothing is
    // not in conflict with itself.
    const findings = detectUnownedEntries({
      ownership: [],
      configs: [config(['somebody-elses-tool hook'])],
      identify,
    });
    assert.deepEqual(findings, []);
  });

  it('reports an unrecognised command as unrecognised rather than as a provider', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude', 'my-own-script.sh'])],
      identify,
    });
    assert.match(findings[0]?.detail.join(' ') ?? '', /does not recognise/);
  });

  it('collapses into the status report shape without losing the command', () => {
    const findings = detectUnownedEntries({
      ownership: OWNERSHIP,
      configs: [config(['rtk hook claude', 'harnesstrim hook claude'])],
      identify,
    });
    const reported = toReportedDrift(findings[0] as (typeof findings)[number]);

    assert.equal(reported.code, 'unowned-entry-on-exclusive-scope');
    assert.equal(reported.path, 'C:\\Users\\dev\\.claude\\settings.json');
    assert.match(reported.detail, /harnesstrim hook claude/);
  });
});

describe('the shipped rule table', () => {
  it('records the RTK and HarnessTrim overlap with a citation', () => {
    const rule = COMPATIBILITY_RULES.find((entry) =>
      entry.capabilities.includes('shell.output.reduce'),
    );
    assert.ok(rule);
    assert.equal(rule.outcome, 'conflict');
    // A rule is a permission, so the shipped table grants none: this entry exists to carry a
    // reason the fail-closed default cannot.
    assert.ok(rule.fixtures.length > 0);
    assert.ok(rule.rationale.length > 0);
  });

  it('grants no provider pair permission to share an exclusive scope', () => {
    for (const rule of COMPATIBILITY_RULES) {
      if (rule.outcome === 'conflict') continue;
      // Any future permissive rule must name a fixture; RFC 0003 requires the pair, order,
      // versions, and fixture together.
      assert.ok(rule.fixtures.length > 0, `${rule.id} permits composition with no fixture`);
      assert.ok(
        Object.keys(rule.testedVersions).length > 0,
        `${rule.id} permits composition with no tested versions`,
      );
    }
  });
});

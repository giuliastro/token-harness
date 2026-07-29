/**
 * Windows ACL evaluation — RFC 0004 §State directory permissions.
 *
 * "on Windows, parse the effective ACL and assert the ACE set, including a fixture
 * with a widened inherited ACL that must be rejected."
 *
 * That fixture is the fourth case below. It is a string, so it runs on Linux and
 * macOS too — which matters, because a widened profile ACL is not a state a CI
 * runner can be put into on demand.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateStateRootAcl,
  grantsRead,
  parseSecurityDescriptor,
  resolveAcePrincipal,
  stateRootGrantArguments,
} from '../src/index.js';

const OWNER = 'S-1-5-21-1004336348-1177238915-682003330-1001';

/** What `icacls /inheritance:r /grant:r` produces: protected, no inherited ACEs. */
const PROTECTED_CORRECT = `O:${OWNER}G:${OWNER}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${OWNER})`;

/** The default inherited profile ACL. Correct principals, but nothing pinning them. */
const INHERITED_CORRECT = `O:${OWNER}D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${OWNER})`;

/** The RFC's widened-profile case: `WD` is Everyone, arriving by inheritance. */
const INHERITED_WIDENED = `O:${OWNER}D:AI(A;OICIID;FA;;;WD)(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${OWNER})`;

interface Case {
  name: string;
  sddl: string;
  ok: boolean;
  unexpected: readonly string[];
  inheritanceBlocked: boolean;
}

const CASES: readonly Case[] = [
  {
    name: 'the DACL Token Harness writes',
    sddl: PROTECTED_CORRECT,
    ok: true,
    unexpected: [],
    inheritanceBlocked: true,
  },
  {
    name: 'an inherited ACL with only permitted principals',
    sddl: INHERITED_CORRECT,
    ok: true,
    unexpected: [],
    inheritanceBlocked: false,
  },
  {
    name: 'a widened inherited ACL granting Everyone',
    sddl: INHERITED_WIDENED,
    ok: false,
    unexpected: ['WD'],
    inheritanceBlocked: false,
  },
  {
    name: 'Authenticated Users, which is not "local administrators"',
    sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${OWNER})(A;OICI;FR;;;AU)`,
    ok: false,
    unexpected: ['AU'],
    inheritanceBlocked: true,
  },
  {
    name: 'another local user added by hand',
    sddl: `D:PAI(A;OICI;FA;;;${OWNER})(A;OICI;FR;;;S-1-5-21-1004336348-1177238915-682003330-1002)`,
    ok: false,
    unexpected: ['S-1-5-21-1004336348-1177238915-682003330-1002'],
    inheritanceBlocked: true,
  },
  {
    name: 'a hex access mask that includes list-directory',
    sddl: `D:PAI(A;OICI;0x1200a9;;;WD)(A;OICI;FA;;;${OWNER})`,
    ok: false,
    unexpected: ['WD'],
    inheritanceBlocked: true,
  },
  {
    name: 'a hex access mask that grants only write',
    sddl: `D:PAI(A;OICI;0x00000002;;;WD)(A;OICI;FA;;;${OWNER})`,
    ok: true,
    unexpected: [],
    inheritanceBlocked: true,
  },
  {
    name: 'a deny ACE, which restricts rather than widens',
    sddl: `D:PAI(D;OICI;FA;;;WD)(A;OICI;FA;;;${OWNER})`,
    ok: true,
    unexpected: [],
    inheritanceBlocked: true,
  },
  {
    name: 'an inherit-only ACE, which does not apply to this directory',
    sddl: `D:PAI(A;OICIIO;FA;;;WD)(A;OICI;FA;;;${OWNER})`,
    ok: true,
    unexpected: [],
    inheritanceBlocked: true,
  },
  {
    name: 'CREATOR OWNER and OWNER RIGHTS, which grant nothing beyond the owner',
    sddl: `D:PAI(A;OICI;FA;;;CO)(A;OICI;FA;;;OW)(A;OICI;FA;;;${OWNER})`,
    ok: true,
    unexpected: [],
    inheritanceBlocked: true,
  },
  {
    name: 'the built-in Administrator account, which is not the Administrators group',
    sddl: `D:PAI(A;OICI;FA;;;LA)(A;OICI;FA;;;${OWNER})`,
    ok: false,
    unexpected: ['LA'],
    inheritanceBlocked: true,
  },
];

describe('state root ACL evaluation', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const evaluation = evaluateStateRootAcl(testCase.sddl, OWNER);
      assert.notEqual(evaluation, null);
      if (evaluation === null) return;
      assert.equal(evaluation.ok, testCase.ok);
      assert.deepEqual(evaluation.unexpectedPrincipals, testCase.unexpected);
      assert.equal(evaluation.inheritanceBlocked, testCase.inheritanceBlocked);
    });
  }

  it('treats a NULL DACL as the most permissive state, not as "no rules found"', () => {
    const evaluation = evaluateStateRootAcl(`O:${OWNER}G:${OWNER}`, OWNER);
    assert.notEqual(evaluation, null);
    assert.equal(evaluation?.ok, false);
    assert.deepEqual(evaluation?.unexpectedPrincipals, ['<null-dacl>']);
  });

  it('treats NO_ACCESS_CONTROL the same way', () => {
    const evaluation = evaluateStateRootAcl('D:NO_ACCESS_CONTROL', OWNER);
    assert.equal(evaluation?.ok, false);
  });

  it('returns null for a descriptor it cannot parse, so the caller reports it unproven', () => {
    for (const bad of ['', '   ', 'not a descriptor', 'D:PAI(A;OICI;FA;;;)']) {
      assert.equal(evaluateStateRootAcl(bad, OWNER), null, JSON.stringify(bad));
    }
  });

  /**
   * The case CI found on the first push. The GitHub Windows runner's interactive
   * user *is* the built-in Administrator account, so `whoami` reports a SID ending
   * in -500 and `icacls` writes that same principal back as the alias `LA`.
   * Comparing the alias to the raw SID rejected the owner's own ACE.
   */
  it('accepts LA when the owner is account 500, and rejects it when the owner is not', () => {
    const builtIn = 'S-1-5-21-1742564184-1656218818-310408600-500';
    const ordinary = 'S-1-5-21-1742564184-1656218818-310408600-1001';
    const sddl = 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;LA)';

    assert.equal(evaluateStateRootAcl(sddl, builtIn)?.ok, true);

    const other = evaluateStateRootAcl(sddl, ordinary);
    assert.equal(other?.ok, false);
    assert.deepEqual(other?.unexpectedPrincipals, ['LA']);
  });

  it('resolves a domain-relative alias against the owner authority, not a fixed SID', () => {
    const owner = 'S-1-5-21-1-2-3-1001';
    assert.equal(resolveAcePrincipal('LA', owner), 'S-1-5-21-1-2-3-500');
    assert.equal(resolveAcePrincipal('DA', owner), 'S-1-5-21-1-2-3-512');
    assert.equal(resolveAcePrincipal('SY', owner), 'S-1-5-18');
    assert.equal(resolveAcePrincipal('WD', owner), 'WD');
    // With no machine authority to resolve against, the alias stays an alias — and
    // therefore stays unpermitted.
    assert.equal(resolveAcePrincipal('LA', 'S-1-5-18'), 'LA');
  });

  it('does not accept Domain Admins as an alias for the local Administrators group', () => {
    const owner = 'S-1-5-21-1-2-3-1001';
    const evaluation = evaluateStateRootAcl(`D:PAI(A;OICI;FA;;;DA)(A;OICI;FA;;;${owner})`, owner);
    assert.equal(evaluation?.ok, false);
    assert.deepEqual(evaluation?.unexpectedPrincipals, ['DA']);
  });

  it('matches the owner SID case-insensitively', () => {
    const evaluation = evaluateStateRootAcl(`D:PAI(A;OICI;FA;;;${OWNER})`, OWNER.toLowerCase());
    assert.equal(evaluation?.ok, true);
  });
});

describe('rights parsing fails closed', () => {
  const readGranting = ['FA', 'FR', 'FX', 'GA', 'GR', 'GX', 'KR', '0x1', '0x1200a9', '0xffffffff'];
  const notReadGranting = ['FW', 'GW', '0x2', '0x100'];

  for (const rights of readGranting) {
    it(`${rights} grants read`, () => assert.equal(grantsRead(rights), true));
  }
  for (const rights of notReadGranting) {
    it(`${rights} does not grant read`, () => assert.equal(grantsRead(rights), false));
  }
  for (const rights of ['', 'FILE_ALL_ACCESS', 'ODD', '0xzz']) {
    it(`${JSON.stringify(rights)} is treated as granting read, because it was not understood`, () =>
      assert.equal(grantsRead(rights), true));
  }
});

describe('descriptor parsing', () => {
  it('records the inheritance flag on each ACE', () => {
    const parsed = parseSecurityDescriptor(INHERITED_WIDENED);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.aces.length, 4);
    assert.equal(
      parsed?.aces.every((ace) => ace.inherited),
      true,
    );
    assert.deepEqual(parsed?.daclFlags, ['AI']);
  });

  it('reads owner and group', () => {
    const parsed = parseSecurityDescriptor(PROTECTED_CORRECT);
    assert.equal(parsed?.owner, OWNER);
    assert.equal(parsed?.group, OWNER);
    assert.deepEqual(parsed?.daclFlags, ['P', 'AI']);
  });
});

describe('the DACL Token Harness asks for', () => {
  it('grants by SID, so it is neither localised nor domain-dependent', () => {
    assert.deepEqual(stateRootGrantArguments(OWNER), [
      `*${OWNER}:(OI)(CI)(F)`,
      '*S-1-5-18:(OI)(CI)(F)',
      '*S-1-5-32-544:(OI)(CI)(F)',
    ]);
  });

  it('produces a DACL its own evaluator accepts', () => {
    // The grant list and the policy that checks it are written from the same
    // permitted set; this is the test that keeps them from drifting apart.
    const asSddl = `D:PAI${stateRootGrantArguments(OWNER)
      .map((grant) => `(A;OICI;FA;;;${grant.slice(1).split(':')[0] ?? ''})`)
      .join('')}`;
    const evaluation = evaluateStateRootAcl(asSddl, OWNER);
    assert.equal(evaluation?.ok, true);
    assert.equal(evaluation?.inheritanceBlocked, true);
  });
});

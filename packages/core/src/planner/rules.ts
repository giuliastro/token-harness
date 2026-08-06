/**
 * The compatibility-rule table — RFC 0003 §Scope of the resolver at 0.1.0, item 1:
 * "a static compatibility-rule table, committed as data".
 *
 * Data, in a source file, rather than a YAML asset: the table is part of the program's
 * safety argument, `isWellFormedRule` checks its shape, and a rule shipped as data outside
 * the type system could be malformed in a build that still passed its tests.
 *
 * ## Why it is nearly empty, and why that is correct
 *
 * A rule is a *permission*. It says a named provider pair may share a named capability on a
 * named harness, in a named order, with a fixture proving it. RFC 0003 sets a high bar:
 *
 * > "Chainable" is not permission to compose arbitrary providers. A compatibility rule must
 * > name the provider pair, order, supported versions, and test fixture.
 *
 * At `0.1.0` no provider pair has been demonstrated to compose. RTK and HarnessTrim overlap
 * exactly — RFC 0003 §The table is an intent establishes that on every MVP harness
 * HarnessTrim's reducing surface "either is exactly the one assigned to RTK or strictly
 * contains it, and no configuration narrows it" — so there is nothing to permit. The one
 * rule below records that overlap as an incompatibility rather than leaving it to the
 * fail-closed default, because a named rule can carry the reason and the default cannot.
 *
 * An empty table is therefore the honest state, and it is also the safe one: with no rules,
 * every overlapping exclusive claim is a hard conflict. Adding a rule is how the project
 * takes on a claim, so rules are added when a fixture exists, never to unblock a plan.
 */

import { providerId } from '../domain/ids.js';
import type { CompatibilityRule } from '../domain/compatibility.js';

const RTK = providerId('rtk');
const HARNESSTRIM = providerId('harnesstrim');

/**
 * RFC 0003 §The table is an intent, as a rule.
 *
 * The `conflict` outcome and the fail-closed default reach the same decision, and this rule
 * exists for what the default cannot say: *why*. A user who sees
 * `exclusive-scope-incompatible` with this rationale learns that the overlap is a measured
 * property of HarnessTrim `0.0.5` rather than a gap in Token Harness's data.
 *
 * `fixtures` names the RFC section rather than a test file. The finding came from reading
 * HarnessTrim's source at `0.0.5`, and the citation is what makes it checkable; inventing a
 * fixture path that does not exist would be worse than an honest reference.
 */
const RTK_HARNESSTRIM_SHELL_OVERLAP: CompatibilityRule = {
  id: 'rtk-harnesstrim-shell-output-overlap',
  providers: [RTK, HARNESSTRIM],
  // Every harness: the RFC checked all three MVP adapters and found the same overlap on each,
  // for different reasons. Listing them individually would imply a fourth harness is exempt.
  harnesses: '*',
  capabilities: ['shell.output.reduce'],
  outcome: 'narrowed',
  retains: RTK,
  testedVersions: { rtk: '0.44.0', harnesstrim: '0.1.0' },
  rationale:
    'RTK keeps shell output reduction: it rewrites the command, so the output arriving at any later point is already reduced, and reducing it again loses signal and counts the saving twice. HarnessTrim 0.1.0 no longer has to be excluded whole for that — `--no-hook` and `--no-instructions` produce a Claude install that adds skills and reduces nothing, and `--tools` confines its OpenCode reduction to a chosen tool family. So it is narrowed to the form that leaves this channel alone, rather than refused. At 0.0.5 no flag produced any of those states, which is why this rule read `conflict` and said no configuration narrows it.',
  fixtures: ['docs/rfcs/0003-capabilities-and-conflicts.md#the-table-is-an-intent'],
};

/**
 * The table.
 *
 * Exported as a value so a caller can pass a different one — the resolver takes rules as
 * input rather than reading this module, which is what lets a test drive the fail-closed
 * path with an empty table and the ordered path with a fixture rule.
 */
export const COMPATIBILITY_RULES: readonly CompatibilityRule[] = [RTK_HARNESSTRIM_SHELL_OVERLAP];

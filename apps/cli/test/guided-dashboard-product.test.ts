import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('outcome-first guided dashboard', () => {
  it('puts user outcomes ahead of implementation detail', () => {
    assert.match(GUIDE_HTML, />Dashboard</);
    assert.match(GUIDE_HTML, />Policies</);
    assert.match(GUIDE_HTML, />Evidence</);
    assert.match(GUIDE_HTML, /5h \/ 7d allowance saved/);
    assert.match(GUIDE_HTML, /API cost saved/);
    assert.match(GUIDE_HTML, /Quality/);
    assert.match(GUIDE_HTML, /What to do next/);
    assert.match(GUIDE_HTML, /Save coding allowance without guessing/);
  });

  it('does not invent plan-time, API-cost or quality savings', () => {
    assert.match(GUIDE_JS, /5h \/ 7d allowance saved/);
    assert.match(GUIDE_JS, /Not measured yet/);
    assert.match(GUIDE_JS, /paired allowance evidence/);
    assert.match(GUIDE_JS, /billed-token evidence/);
    assert.match(GUIDE_JS, /Actual quality impact still requires paired task evidence/);
  });

  it('never schedules a full dashboard refresh in the background', () => {
    assert.doesNotMatch(GUIDE_JS, /setInterval\([^]*refresh\(/);
    assert.match(GUIDE_JS, /setInterval\([^]*activity\(\)/);
    assert.match(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', changePeriod\)/);
    assert.doesNotMatch(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', refresh\)/);
  });

  it('keeps current results visible after an approved change instead of forcing a reload', () => {
    assert.match(GUIDE_JS, /markStale\(\)/);
    assert.match(GUIDE_JS, /until you choose Refresh/);
    assert.doesNotMatch(GUIDE_JS, /finally\s*\{[^}]*await refresh\(/);
  });

  it('keeps the existing loading-card contract for both primary agents', () => {
    assert.equal(GUIDE_HTML.match(/class="panel agent loading-card"/g)?.length, 2);
    assert.equal(GUIDE_HTML.includes('class="panel loading-card"'), false);
  });
});

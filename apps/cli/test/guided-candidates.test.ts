import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { observation, startGuidedBrowser } from './guided-browser-double.js';

describe('guided optional managed optimizers', () => {
  it('places reviewed tools under More methods instead of Experimental tools', () => {
    assert.match(GUIDE_JS, /Choose the coding apps where \{name\} should work\./);
    assert.match(GUIDE_JS, /optional: !\['rtk', 'harnesstrim'\]\.includes\(id\)/);
    assert.match(GUIDE_JS, /t\('More methods'\)/);
    assert.doesNotMatch(GUIDE_HTML, /Experimental tools/);
    assert.doesNotMatch(GUIDE_JS, /Experimental tools|const EXPERIMENTAL/);
    assert.match(GUIDE_JS, /optimizerIds\(\)/);
  });

  it('sets up each optional optimizer through a provider-scoped managed plan', () => {
    assert.match(GUIDE_JS, /reviewSetup\(method\.key\)/);
    assert.match(GUIDE_JS, /provider: providerId/);
    assert.match(GUIDE_JS, /PolyForm Noncommercial/);
    assert.match(GUIDE_JS, /Token Harness never builds its repository index/);
  });

  it('keeps the recommended baseline distinct from optional managed integrations', async () => {
    assert.match(GUIDE_JS, /recommended: !info\.optional/);
    assert.match(GUIDE_JS, /t\('Recommended'\), t\('On for most people'\)/);
    assert.match(GUIDE_JS, /t\('More methods'\), t\('Useful in specific situations'\)/);
    assert.match(GUIDE_JS, /Detected setup alone does not prove that the optimizer ran/);
    const { get, turn } = await startGuidedBrowser();
    await turn('methods');
    const grids = get('methods-root').querySelectorAll('.method-grid');
    const keys = (index: number) =>
      grids[index]!.querySelectorAll('article.method').map((item) => item.dataset['method']);
    assert.deepEqual(keys(0), ['rtk', 'harnesstrim', 'routing']);
    assert.deepEqual(keys(1), ['reasoning', 'guidance', 'mcptoon', 'gitnexus', 'headroom']);
  });

  it('keeps experimental benchmark evidence labeled in the unified results list', async () => {
    assert.match(GUIDE_JS, /\['candidate', t\('Experiments'\)\]/);
    assert.match(GUIDE_JS, /list\.id = 'result-evidence'/);
    assert.match(GUIDE_JS, /setAttribute\('aria-label', t\('Evidence by source'\)\)/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'candidate'/);
    assert.match(GUIDE_JS, /benchmark-start/);
    assert.match(GUIDE_JS, /Evaluation does not automatically promote or activate this optimizer/);

    const data = observation();
    Object.assign(data.value, {
      candidates: [{ candidateId: 'mcptoon', pairs: 3, optimizedBetter: 2, baselineBetter: 1 }],
    });
    const { get, turn } = await startGuidedBrowser({
      data,
      storage: { 'token-harness-advanced': 'on' },
    });
    await turn('details');
    const row = get('result-evidence').children.find(
      (item) => item.dataset['type'] === 'candidate',
    )!;
    assert.ok(row);
    assert.match(row.textContent, /Experiment.*mcptoon.*Experimental.*3 paired results/);
    assert.match(row.textContent, /Evaluation does not automatically promote or activate/);
    get('evidence-type').value = 'candidate';
    get('evidence-type').fire('change');
    assert.deepEqual(
      get('result-evidence')
        .children.filter((item) => !item.hidden)
        .map((item) => item.dataset['name']),
      ['mcptoon'],
    );
  });

  it('is a self-contained browser controller with no direct package-install execution', () => {
    assert.doesNotMatch(GUIDE_JS, /fetch\([^\n]*(headroom|mcptoon|gitnexus)/i);
    assert.doesNotMatch(
      GUIDE_JS,
      /request\([^\n]*(pip install|pipx install|npm install|uv tool install)/i,
    );
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });
});

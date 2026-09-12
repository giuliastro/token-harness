import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { GUIDE_CANDIDATE_CAMPAIGN_JS } from '../src/guided-candidate-campaign-client.js';

const ROOT = new URL('../../../../', import.meta.url);

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), 'utf8');
}

describe('README onboarding contract', () => {
  it('keeps the primary install/open path aligned with the guided product', async () => {
    const readme = await repositoryFile('README.md');
    const packageJson = JSON.parse(await repositoryFile('package.json')) as {
      engines?: { node?: string };
    };

    assert.match(readme, /npm install --global token-harness@latest/);
    assert.match(readme, /\ntoken-harness\n/);
    assert.match(readme, /browser app is the primary interface/i);
    assert.match(readme, /Node\.js 22\.13 or newer/);
    assert.equal(packageJson.engines?.node, '>=22.13.0');

    for (const [id, label] of [
      ['tab-dashboard', 'Dashboard'],
      ['tab-setup', 'Setup'],
      ['tab-results', 'Results'],
    ] as const) {
      assert.match(GUIDE_HTML, new RegExp(`id="${id}"[^>]*>${label}</button>`));
      assert.match(readme, new RegExp(`\\*\\*${label}\\*\\*|### ${label}`));
    }

    assert.match(GUIDE_HTML, /Nothing changes without your approval/);
    assert.match(readme, /requires an explicit review and approval/i);
  });

  it('documents the same safe candidate-campaign entry point shipped in the UI', async () => {
    const readme = await repositoryFile('README.md');

    assert.match(readme, /Run standard evaluation/);
    assert.match(GUIDE_JS, /Run standard evaluation/);
    assert.match(readme, /Refresh status/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Refresh status/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /\/api\/candidate-campaign/);
    assert.match(readme, /do not need to run a separate status command/i);
    assert.match(readme, /benchmark-matrix/);
    for (const flag of ['--benchmark-id', '--candidate', '--harness']) {
      assert.match(readme, new RegExp(flag));
      assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, new RegExp(flag));
    }

    assert.match(readme, /Decision-ready is not promotion-ready/i);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /not promotion approval/);
    assert.match(readme, /does not treat attribution as\s+proof that the candidate was active/i);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /does not prove the candidate was active/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_CAMPAIGN_JS,
      /headroom wrap|pip install|npm install|gitnexus analyze/,
    );
  });
});

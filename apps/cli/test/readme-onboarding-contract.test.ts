import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { GUIDE_HTML } from '../src/guided-assets.js';

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
    assert.match(readme, /Node\.js 22\.13(?:\+| or newer)/);
    assert.equal(packageJson.engines?.node, '>=22.13.0');

    // The shipped app is organised as Home, Methods and an advanced Details view.
    for (const [id, label] of [
      ['tab-home', 'Home'],
      ['tab-methods', 'Methods'],
      ['tab-details', 'Details'],
    ] as const)
      assert.match(GUIDE_HTML, new RegExp(`id="${id}"[^>]*>${label}</button>`));
    assert.doesNotMatch(GUIDE_HTML, /id="tab-setup"/);
    for (const label of ['Home', 'Methods', 'Details'])
      assert.ok(readme.includes(`**${label}**`), `README names the ${label} tab`);
    assert.doesNotMatch(readme, /\*\*(?:Overview|Results)\*\*/);
    assert.doesNotMatch(readme, /^#{1,3} Setup$/im);
    assert.match(readme, /Turn on the recommended\s+setup/);
    assert.match(readme, /Advanced\s+view/);
    assert.doesNotMatch(readme, /Optimizer setup|Finish setup|Remove managed setup/);
    assert.match(readme, /update\s+strip/);

    assert.match(GUIDE_HTML, /Nothing changes without your approval/);
    assert.match(readme, /requires an explicit review and approval/i);
  });

  it('documents candidate campaigns as an advanced CLI workflow outside novice setup', async () => {
    const onboarding = await repositoryFile('README.md');
    assert.match(onboarding, /\[CLI and evaluation guide\]\(docs\/cli-guide\.md\)/);
    const readme = await repositoryFile('docs/cli-guide.md');

    assert.match(readme, /Evaluation campaigns are an advanced maintainer workflow/i);
    assert.match(readme, /Normal use never requires these commands/i);
    assert.match(readme, /benchmark-matrix/);
    for (const flag of ['--benchmark-id', '--candidate', '--harness'])
      assert.match(readme, new RegExp(flag));
    assert.match(readme, /decision-ready[^]*cannot promote a candidate by itself/i);
    assert.match(readme, /does not treat attribution as\s+proof that the candidate was active/i);
  });
});

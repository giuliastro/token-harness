import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnesstrimAdapter, rtkAdapter } from '../src/index.js';

describe('provider update channels', () => {
  it('uses npm for HarnessTrim package updates', () => {
    assert.deepEqual(
      harnesstrimAdapter.manifest.installationChannels.map((channel) => channel.id),
      ['npm'],
    );
  });

  it('keeps WinGet as the preferred RTK channel on Windows', () => {
    const windows = [...rtkAdapter.manifest.installationChannels]
      .filter((channel) => channel.platforms.includes('windows'))
      .sort((left, right) => left.priority - right.priority);

    assert.equal(windows[0]?.id, 'winget');
  });
});

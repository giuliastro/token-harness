import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadReport } from '../../scripts/download-stats.mjs';

const asset = (name, download_count, state = 'uploaded') => ({ name, download_count, state });
const release = (version, assets, extra = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets,
  ...extra,
});

test('combines paginated desktop counts without mixing checksums, npm or pre-releases', () => {
  const report = downloadReport([
    [
      release('0.1.33', [
        asset('token-harness-0.1.33-windows-x64-setup.exe', 3),
        asset('token-harness-0.1.33-macos-arm64.dmg', 4),
        asset('token-harness-0.1.33-macos-arm64.zip', 2),
        asset('token-harness-0.1.33-linux-amd64.deb', 0),
        asset('token-harness-0.1.33-desktop-SHA256SUMS.txt', 80),
        asset('token-harness-0.1.33.tgz', 90),
        asset('token-harness-0.1.32-windows-x64-setup.exe', 50),
        asset('token-harness-0.1.33-macos-x64.dmg', -1),
        asset('token-harness-0.1.33-linux-x64.tar.gz', 7, 'new'),
      ]),
      release('0.1.34', [asset('token-harness-0.1.34-windows-x64-setup.exe', 100)], {
        prerelease: true,
      }),
      release('0.1.35', [asset('token-harness-0.1.35-windows-x64-setup.exe', 100)], {
        draft: true,
      }),
    ],
    [release('0.1.32', [asset('token-harness-0.1.32-windows-x64-setup.exe', 1)])],
  ]);
  assert.match(report, /\| Windows x64 \| 4 \|/);
  assert.match(report, /\| macOS Apple Silicon \| 6 \|/);
  assert.match(report, /\| Linux x64 \| 0 \|/);
  assert.match(report, /\*\*Total desktop downloads\*\* \| \*\*10\*\*/);
  assert.doesNotMatch(report, /SHA256SUMS|\.tgz|v0\.1\.34|v0\.1\.35/);
  assert.match(report, /not unique people or completed installations/);
});

test('accepts a single release page and rejects an invalid API envelope', () => {
  assert.match(downloadReport([]), /No published desktop assets/);
  assert.match(
    downloadReport([release('0.1.33', [asset('token-harness-0.1.33-linux-x64.tar.gz', 2)])]),
    /\| Linux x64 \| 2 \|/,
  );
  assert.throws(() => downloadReport({ message: 'API error' }), /Expected GitHub releases JSON/);
});

import { pathToFileURL } from 'node:url';

const desktopPackages = new Map([
  ['windows-x64-setup.exe', 'Windows x64'],
  ['macos-arm64.dmg', 'macOS Apple Silicon'],
  ['macos-arm64.zip', 'macOS Apple Silicon'],
  ['macos-x64.dmg', 'macOS Intel'],
  ['macos-x64.zip', 'macOS Intel'],
  ['linux-amd64.deb', 'Linux x64'],
  ['linux-x64.tar.gz', 'Linux x64'],
]);

export function downloadReport(pages) {
  if (!Array.isArray(pages)) throw new Error('Expected GitHub releases JSON.');
  const totals = new Map([...desktopPackages.values()].map((platform) => [platform, 0]));
  const rows = [];
  for (const release of pages.flat()) {
    const match = /^v(\d+\.\d+\.\d+)$/.exec(release?.tag_name);
    if (!match || release.draft !== false || release.prerelease !== false) continue;
    for (const asset of release.assets ?? []) {
      const prefix = `token-harness-${match[1]}-`;
      if (typeof asset.name !== 'string' || !asset.name.startsWith(prefix)) continue;
      const platform = desktopPackages.get(asset.name.slice(prefix.length));
      if (
        !platform ||
        asset.state !== 'uploaded' ||
        !Number.isSafeInteger(asset.download_count) ||
        asset.download_count < 0
      )
        continue;
      totals.set(platform, totals.get(platform) + asset.download_count);
      rows.push(`| ${release.tag_name} | ${asset.name} | ${asset.download_count} |`);
    }
  }
  return [
    '# Desktop download counts',
    '',
    'Source: GitHub Releases `download_count`, across published stable releases.',
    'Landing downloads and downloads from GitHub share these counters. Counts are download requests, not unique people or completed installations; referral sources are not separated.',
    'Includes desktop installers and portable archives. Excludes checksums, source archives, npm tarballs and npm registry installs. Deleted assets and deleted releases are absent from this snapshot.',
    '',
    '| Platform | Downloads |',
    '| --- | ---: |',
    ...[...totals].map(([platform, count]) => `| ${platform} | ${count} |`),
    `| **Total desktop downloads** | **${[...totals.values()].reduce((sum, count) => sum + count, 0)}** |`,
    '',
    '## By release and asset',
    '',
    '| Release | Asset | Downloads |',
    '| --- | --- | ---: |',
    ...rows,
    ...(rows.length ? [] : ['| — | No published desktop assets found | — |']),
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(downloadReport(JSON.parse(input)));
  } catch (error) {
    console.error(`Download report failed: ${error.message}`);
    process.exitCode = 1;
  }
}

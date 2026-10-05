import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function desktopArtifactNames(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('Desktop artifact version must be semver.');
  return [
    `token-harness-${version}-windows-x64-setup.exe`,
    `token-harness-${version}-linux-amd64.deb`,
    `token-harness-${version}-linux-x64.tar.gz`,
    ...['x64', 'arm64'].flatMap((arch) =>
      ['dmg', 'zip'].map((ext) => `token-harness-${version}-macos-${arch}.${ext}`),
    ),
  ];
}

/** Complete coverage is checked before any upload; only these allowlisted files are published. */
export function collectDesktopArtifacts(directory, tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v'))
    throw new Error('Desktop release requires an exact v<semver> tag.');
  const version = tag.slice(1);
  const names = desktopArtifactNames(version);
  const files = names.map((name) => join(directory, name));
  for (const file of files) {
    if (!lstatSync(file).isFile()) throw new Error(`Not a regular desktop artifact: ${file}`);
  }
  const checksumName = `token-harness-${version}-desktop-SHA256SUMS.txt`;
  const checksums =
    files
      .map(
        (file, index) =>
          `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${names[index]}`,
      )
      .join('\n') + '\n';
  const checksumPath = join(directory, checksumName);
  writeFileSync(checksumPath, checksums);
  return [...files, checksumPath];
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[3] !== undefined && process.argv[3] !== '--check')
    throw new Error('Use <tag> [--check].');
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const files = collectDesktopArtifacts(join(repoRoot, 'dist', 'desktop-release'), process.argv[2]);
  if (process.argv[3] === '--check') {
    console.log(
      `Verified ${files.length - 1} desktop packages and checksums for ${process.argv[2]}`,
    );
  } else {
    const result = spawnSync('gh', ['release', 'upload', process.argv[2], ...files, '--clobber'], {
      shell: false,
      stdio: 'inherit',
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0)
      throw new Error(
        'Desktop release asset upload failed; rerun release recovery for the same tag.',
      );
  }
}

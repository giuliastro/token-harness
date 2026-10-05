import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Native packaging keeps the plain Node runtime separate from Electron and from ASAR. */
export async function stageDesktop({
  repoRoot = defaultRoot,
  nodeExecutable = process.execPath,
  nodeVersion = process.versions.node,
  platform = process.platform,
  arch = process.arch,
  nodeLicense,
} = {}) {
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch))
    throw new Error(`Unsupported native desktop target: ${platform}/${arch}`);
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 13)))
    throw new Error('Desktop requires Node 22.13 or newer.');
  if (process.versions.electron !== undefined)
    throw new Error('Stage with plain Node, not Electron.');
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const cli = JSON.parse(readFileSync(join(repoRoot, 'dist', 'package', 'package.json'), 'utf8'));
  if (root.version !== cli.version) throw new Error('Desktop and CLI versions disagree.');
  const license =
    nodeLicense ??
    [join(dirname(nodeExecutable), 'LICENSE'), join(dirname(nodeExecutable), '..', 'LICENSE')].find(
      (candidate) => existsSync(candidate),
    );
  if (license === undefined)
    throw new Error('The upstream Node LICENSE must accompany the bundled executable.');
  const output = join(repoRoot, 'dist', 'desktop');
  rmSync(output, { recursive: true, force: true });
  const appDirectory = join(output, 'app');
  const resources = join(output, 'resources');
  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(join(resources, 'runtime'), { recursive: true });
  cpSync(join(repoRoot, 'dist', 'package'), join(resources, 'backend'), { recursive: true });
  writeFileSync(
    join(resources, 'backend', 'package.json'),
    JSON.stringify({ ...cli, tokenHarnessDistribution: 'desktop' }, null, 2) + '\n',
  );
  copyFileSync(
    nodeExecutable,
    join(resources, 'runtime', platform === 'win32' ? 'node.exe' : 'node'),
  );
  copyFileSync(license, join(resources, 'runtime', 'LICENSE'));
  writeFileSync(
    join(resources, 'runtime', 'runtime.json'),
    JSON.stringify({ nodeVersion, platform, arch }, null, 2) + '\n',
  );
  copyFileSync(join(repoRoot, 'LICENSE'), join(appDirectory, 'LICENSE'));
  writeFileSync(
    join(appDirectory, 'package.json'),
    JSON.stringify(
      {
        name: 'token-harness-desktop',
        desktopName: 'token-harness-desktop.desktop',
        productName: 'Token Harness',
        version: cli.version,
        description: cli.description,
        author: 'Token Harness contributors',
        license: root.license,
        homepage: 'https://github.com/giuliastro/token-harness',
        main: 'main.cjs',
      },
      null,
      2,
    ) + '\n',
  );
  await build({
    entryPoints: [join(repoRoot, 'apps', 'desktop', 'dist', 'src', 'main.js')],
    outfile: join(appDirectory, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22.13',
    external: ['electron', 'node:*'],
    logLevel: 'warning',
  });
  const config = JSON.parse(
    readFileSync(join(repoRoot, 'apps', 'desktop', 'electron-builder.json'), 'utf8'),
  );
  config.electronVersion = root.devDependencies.electron;
  writeFileSync(join(output, 'electron-builder.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(`Staged desktop ${cli.version}: ${platform}/${arch}, Node ${nodeVersion}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await stageDesktop();

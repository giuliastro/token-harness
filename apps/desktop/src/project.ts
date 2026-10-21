import type { NodeFileSystem } from '@token-harness/platform';
import { isAbsolute } from 'node:path';
type ProjectFileSystem = Pick<
  NodeFileSystem,
  'join' | 'stat' | 'readFile' | 'canonicalPath' | 'atomicWriteFile'
>;

/** Only the native folder chooser writes this preference; renderer input never selects a path. */
export async function lastDesktopProject(
  fs: ProjectFileSystem,
  profile: string,
  home: string,
): Promise<string> {
  try {
    const path = fs.join(profile, 'project.json');
    const info = await fs.stat(path);
    if (info?.kind !== 'file' || info.byteLength > 8192) return home;
    const value = JSON.parse(new TextDecoder().decode(await fs.readFile(path))) as Record<
      string,
      unknown
    >;
    if (
      value['schemaVersion'] !== 1 ||
      typeof value['project'] !== 'string' ||
      !isAbsolute(value['project'])
    )
      return home;
    const project = await fs.canonicalPath?.(value['project']);
    return project !== null &&
      project !== undefined &&
      (await fs.stat(project))?.kind === 'directory'
      ? project
      : home;
  } catch {
    return home;
  }
}

export async function rememberDesktopProject(
  fs: ProjectFileSystem,
  profile: string,
  project: string,
): Promise<void> {
  if (!isAbsolute(project)) throw new Error('The selected project folder must be absolute.');
  const canonical = await fs.canonicalPath?.(project);
  if (
    canonical === null ||
    canonical === undefined ||
    (await fs.stat(canonical))?.kind !== 'directory'
  )
    throw new Error('The selected project folder is no longer available.');
  if (fs.atomicWriteFile === undefined)
    throw new Error('Project preferences cannot be stored safely.');
  await fs.atomicWriteFile(
    fs.join(profile, 'project.json'),
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, project: canonical }) + '\n'),
  );
}

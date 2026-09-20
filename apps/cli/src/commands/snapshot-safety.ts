import type { CommandContext } from './context.js';

/**
 * Finds the actual VCS repository that must never contain Token Harness backups.
 *
 * Command `projectRoot` is a working scope, not necessarily a repository. In particular the guided
 * app is commonly launched from the user's home directory so user-level Claude/Codex skills land in
 * the standard home-scoped locations. On every supported OS the Token Harness state directory also
 * lives under that home. Treating the whole home as a repository therefore made every transactional
 * mutation fail before it started.
 *
 * We keep the backup invariant, but apply it to what the invariant actually names: a repository.
 * A .git file counts (worktrees/submodules), and Mercurial/Subversion roots are protected too.
 */
export async function repositoryRootForBackupSafety(
  context: CommandContext,
): Promise<string | null> {
  const adapters = context.adapters;
  if (adapters === null) return context.projectRoot;

  const fs = adapters.fs;
  let current = context.projectRoot;
  while (true) {
    for (const marker of ['.git', '.hg', '.svn']) {
      if ((await fs.stat(fs.join(current, marker))) !== null) return current;
    }

    if (
      context.home !== null &&
      fs.isInside(current, context.home) &&
      fs.isInside(context.home, current)
    ) {
      return null;
    }

    const parent = fs.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

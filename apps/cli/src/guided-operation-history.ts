/** Private guided history projection; journal contents never cross the browser boundary. */
import {
  FileJournalStore,
  readMutationLease,
  type FileSystemPort,
  type TransactionJournal,
} from '@token-harness/core';

export interface GuideOperation {
  startedAt: string;
  finishedAt: string | null;
  outcome: TransactionJournal['outcome'];
  actions: string[];
  files: number;
  canRestore: boolean;
}
export interface GuideOperationHistory {
  state: 'ready' | 'unavailable';
  operations: GuideOperation[];
  note: string;
}
export interface GuideOperationObservation {
  history: GuideOperationHistory;
  /** Server-only exact latest-transaction guard, never a browser-supplied selector. */
  target: { transactionId: string; operation: GuideOperation } | null;
}
export type GuideOperationReader = () => Promise<GuideOperationObservation>;

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'create-directory': 'Create configuration directory',
  'write-owned-file': 'Write managed configuration',
  'merge-json': 'Update JSON configuration',
  'merge-yaml': 'Update YAML configuration',
  'merge-toml': 'Update TOML configuration',
  'remove-owned-change': 'Remove managed configuration',
  'package-manager-install': 'Install or update a package',
  'delegated-provider-install': 'Run provider setup',
  'download-artifact': 'Download an artifact',
  'run-installer-command': 'Run an installer',
};
const FILE_ACTIONS = new Set([
  'create-directory',
  'write-owned-file',
  'merge-json',
  'merge-yaml',
  'merge-toml',
  'remove-owned-change',
]);
const OUTCOMES = new Set(['committed', 'rolled-back', 'dirty', 'in-progress']);

export function unavailableGuideOperations(): GuideOperationObservation {
  return {
    history: {
      state: 'unavailable',
      operations: [],
      note: 'Operation history could not be read safely. Keep the local journals and backups; refresh before reviewing recovery.',
    },
    target: null,
  };
}

function readable(journal: TransactionJournal, id: string): boolean {
  return (
    journal.transactionId === id &&
    /^[A-Za-z0-9_-]{1,128}$/.test(id) &&
    typeof journal.projectRoot === 'string' &&
    journal.projectRoot.length > 0 &&
    Number.isFinite(Date.parse(journal.startedAt)) &&
    (journal.finishedAt === null || Number.isFinite(Date.parse(journal.finishedAt))) &&
    OUTCOMES.has(journal.outcome) &&
    Array.isArray(journal.entries) &&
    journal.entries.every(
      (entry) =>
        entry !== null &&
        typeof entry.kind === 'string' &&
        Array.isArray(entry.snapshots) &&
        entry.snapshots.every(
          (snapshot) =>
            snapshot !== null &&
            snapshot.schemaVersion === 1 &&
            typeof snapshot.path === 'string' &&
            snapshot.path.length > 0,
        ),
    )
  );
}

export function createGuideOperationReader(input: {
  fs: FileSystemPort | null;
  stateRoot: string | null;
  projectRoot: string;
}): GuideOperationReader {
  return async () => {
    if (input.fs === null || input.stateRoot === null) return unavailableGuideOperations();
    const fs = input.fs;
    try {
      const journalRoot = fs.join(input.stateRoot, 'journals');
      const store = new FileJournalStore({
        fs,
        journalRoot,
        backupRoot: fs.join(input.stateRoot, 'backups'),
      });
      const journals: TransactionJournal[] = [];
      for (const filename of await fs.readDirectory(journalRoot)) {
        if (!filename.endsWith('.json')) continue;
        const id = filename.slice(0, -5);
        const journal = await store.read(id);
        // Never skip a future/corrupt record and offer an older transaction as the tip.
        if (journal === null || !readable(journal, id)) return unavailableGuideOperations();
        journals.push(journal);
      }
      journals.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const lease = await readMutationLease(fs, input.stateRoot);
      const pending = journals.some((item) => ['dirty', 'in-progress'].includes(item.outcome));
      const latest = journals.find((item) => item.outcome === 'committed');
      const scoped = journals.filter(
        (item) =>
          fs.isInside(item.projectRoot, input.projectRoot) &&
          fs.isInside(input.projectRoot, item.projectRoot),
      );
      let target: GuideOperationObservation['target'] = null;
      const operations = scoped.slice(0, 20).map((item): GuideOperation => {
        const files = new Set(item.entries.flatMap((entry) => entry.snapshots.map((s) => s.path)))
          .size;
        const canRestore =
          item === latest &&
          !pending &&
          lease === null &&
          files > 0 &&
          item.entries.every(
            (entry) => FILE_ACTIONS.has(entry.kind) && entry.packageInventory == null,
          );
        const operation: GuideOperation = {
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
          outcome: item.outcome,
          actions: [
            ...new Set(
              item.entries.map((entry) =>
                Object.hasOwn(ACTION_LABELS, entry.kind)
                  ? ACTION_LABELS[entry.kind]!
                  : 'Managed operation',
              ),
            ),
          ],
          files,
          canRestore,
        };
        if (canRestore) target = { transactionId: item.transactionId, operation };
        return operation;
      });
      return {
        history: {
          state: 'ready',
          operations,
          note:
            lease !== null
              ? 'A benchmark holds temporary configuration. Finish or restore that benchmark before other recovery.'
              : pending
                ? 'An unfinished operation needs attention. Inspect its local journal and backups before making further changes.'
                : 'Latest 20 retained operations for this project, including previous app and CLI sessions. Only the latest committed configuration transaction on this machine can be restored here; package and older transaction recovery remain CLI workflows.',
        },
        target,
      };
    } catch {
      return unavailableGuideOperations();
    }
  };
}

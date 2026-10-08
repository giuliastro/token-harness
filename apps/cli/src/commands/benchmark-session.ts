/** Private recovery checkpoint; raw configuration stays in the protected snapshot store. */
import {
  EXIT_CODES,
  FileJournalStore,
  TransactionSnapshotStore,
  MUTATION_LEASE_FILENAME,
  fileFingerprint,
  fingerprintMatches,
  readMutationLease,
  isTaskBenchmarkId,
  FACTORIAL_BENCHMARK_ARMS,
  commandResult,
  diagnostic,
  digestText,
  isHarnessId,
  JOURNAL_SCHEMA_VERSION,
  type TransactionJournal,
  type CommandResult,
  type Diagnostic,
  type FileFingerprint,
  type FileSnapshot,
  type FileSystemPort,
  type TaskBenchmarkPreparedConfiguration,
  type HarnessId,
} from '@token-harness/core';
import type { CommandContext } from './context.js';
import { repositoryRootForBackupSafety } from './snapshot-safety.js';

export interface BenchmarkArmSession {
  schemaVersion: 1;
  benchmarkId: string;
  variant: string;
  projectId: string;
  harness: HarnessId;
  transactionId: string;
  planId: string;
  initialConfigurationId: string;
  providers: string[];
  status: 'applying' | 'ready' | 'restoring' | 'restored';
  before: FileFingerprint[];
  prefixes: FileFingerprint[][];
  snapshots: FileSnapshot[];
}
export interface BenchmarkRestoreReport {
  benchmarkId: string;
  variant: string;
  status: 'planned' | 'restored' | 'blocked';
  paths: string[];
}

export function benchmarkSessionPath(context: CommandContext, id: string, variant: string): string {
  if (
    context.adapters === null ||
    context.stateRoot === null ||
    !isTaskBenchmarkId(id) ||
    !(FACTORIAL_BENCHMARK_ARMS as readonly string[]).includes(variant)
  )
    throw new Error('Invalid benchmark session identity');
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', id, `${variant}.session.json`);
}
export async function saveBenchmarkSession(
  context: CommandContext,
  session: BenchmarkArmSession,
): Promise<void> {
  if (context.adapters?.fs.atomicWriteFile === undefined)
    throw new Error('Atomic checkpoint writes are unavailable');
  await context.adapters.fs.atomicWriteFile(
    benchmarkSessionPath(context, session.benchmarkId, session.variant),
    encodeBenchmarkSession(session),
  );
}
export function encodeBenchmarkSession(session: BenchmarkArmSession): Uint8Array {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...session, checkpointDigest: digestText(JSON.stringify(session)) }, null, 2) +
      '\n',
  );
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new Error('Recovery checkpoint exceeds size limit');
  return bytes;
}
export async function readBenchmarkSession(
  context: CommandContext,
  id: string,
  variant: string,
): Promise<BenchmarkArmSession | null> {
  if (context.adapters === null) return null;
  const path = benchmarkSessionPath(context, id, variant);
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return null;
  if (stat.kind !== 'file' || stat.byteLength > 16 * 1024 * 1024)
    throw new Error('Recovery checkpoint exceeds size limit');
  const raw: unknown = JSON.parse(
    new TextDecoder().decode(await context.adapters.fs.readFile(path)),
  );
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Malformed recovery checkpoint');
  const { checkpointDigest, ...data } = raw as Record<string, unknown>;
  if (checkpointDigest !== digestText(JSON.stringify(data)))
    throw new Error('Recovery checkpoint integrity mismatch');
  const s = data as unknown as BenchmarkArmSession;
  const hash = (v: unknown) => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
  const mode = (v: unknown) => v === null || (typeof v === 'string' && /^[0-7]{4}$/.test(v));
  const fingerprint = (f: FileFingerprint) =>
    f !== null &&
    typeof f === 'object' &&
    typeof f.path === 'string' &&
    f.path.length > 0 &&
    f.path.length < 4096 &&
    context.adapters!.fs.join(f.path) === f.path &&
    ['absent', 'file', 'directory'].includes(f.kind) &&
    mode(f.mode) &&
    (f.kind === 'absent' ? f.digest === null && f.mode === null : hash(f.digest));
  if (
    s.schemaVersion !== 1 ||
    s.benchmarkId !== id ||
    s.variant !== variant ||
    typeof s.transactionId !== 'string' ||
    !/^factorial-[a-f0-9]{24}$/.test(s.transactionId) ||
    typeof s.planId !== 'string' ||
    !/^[a-f0-9]{8}$/.test(s.planId) ||
    !hash(s.initialConfigurationId) ||
    typeof s.projectId !== 'string' ||
    s.projectId.length === 0 ||
    s.projectId.length > 256 ||
    !isHarnessId(s.harness) ||
    !Array.isArray(s.providers) ||
    s.providers.length < 1 ||
    s.providers.length > 2 ||
    s.providers.some((p) => p !== 'rtk' && p !== 'harnesstrim') ||
    new Set(s.providers).size !== s.providers.length ||
    !['applying', 'ready', 'restoring', 'restored'].includes(s.status) ||
    !Array.isArray(s.before) ||
    s.before.length > 256 ||
    !s.before.every(fingerprint) ||
    !Array.isArray(s.prefixes) ||
    s.prefixes.length < 1 ||
    s.prefixes.length > 257 ||
    !Array.isArray(s.snapshots) ||
    s.snapshots.length !== s.before.length
  )
    throw new Error('Benchmark recovery checkpoint is malformed');
  const paths = new Set(s.before.map((f) => f.path));
  if (
    paths.size !== s.before.length ||
    JSON.stringify(s.prefixes[0]) !== JSON.stringify(s.before) ||
    s.prefixes.some(
      (prefix) =>
        !Array.isArray(prefix) ||
        prefix.length !== s.before.length ||
        prefix.some((f, i) => !fingerprint(f) || f.path !== s.before[i]!.path),
    ) ||
    s.before.some(
      (f, i) =>
        context.adapters!.fs.isInside(context.stateRoot!, f.path) ||
        (!context.adapters!.fs.isInside(f.path, context.projectRoot) &&
          (context.home === null || !context.adapters!.fs.isInside(f.path, context.home))) ||
        s.before.slice(i + 1).some((parent) => context.adapters!.fs.isInside(f.path, parent.path)),
    ) ||
    s.snapshots.some((snapshot, i) => {
      const before = s.before[i]!;
      return (
        snapshot === null ||
        typeof snapshot !== 'object' ||
        snapshot.schemaVersion !== 1 ||
        snapshot.path !== before.path ||
        snapshot.existed !== (before.kind !== 'absent') ||
        snapshot.wasDirectory !== (before.kind === 'directory') ||
        !mode(snapshot.mode) ||
        snapshot.mode !== before.mode ||
        typeof snapshot.capturedAt !== 'string' ||
        !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
        (before.kind === 'file'
          ? snapshot.digest !== before.digest ||
            typeof snapshot.contentRef !== 'string' ||
            !/^\d{4}\.content$/.test(snapshot.contentRef) ||
            !Number.isSafeInteger(snapshot.byteLength) ||
            snapshot.byteLength === null ||
            snapshot.byteLength < 0 ||
            snapshot.byteLength > 8 * 1024 * 1024
          : snapshot.digest !== null ||
            snapshot.contentRef !== null ||
            snapshot.byteLength !== null)
      );
    }) ||
    new Set(s.snapshots.filter((s) => s.contentRef !== null).map((s) => s.contentRef)).size !==
      s.snapshots.filter((s) => s.contentRef !== null).length
  )
    throw new Error('Benchmark recovery paths or snapshot references conflict');
  return s;
}
export function preparedConfiguration(
  session: BenchmarkArmSession,
): TaskBenchmarkPreparedConfiguration {
  return {
    source: 'managed-config-only',
    transactionId: session.transactionId,
    planId: session.planId,
    providers: session.providers,
    initialConfigurationId: session.initialConfigurationId,
  };
}

export async function benchmarkSessionDrift(
  fs: FileSystemPort,
  session: BenchmarkArmSession,
): Promise<string[]> {
  const paths = session.before.map((f) => f.path);
  const current = await Promise.all(paths.map((path) => fileFingerprint(fs, path)));
  const candidates = session.status === 'ready' ? [session.prefixes.at(-1)!] : session.prefixes;
  const changed: string[] = [];
  for (let i = 0; i < current.length; i++) {
    const actual = current[i]!;
    let allowed = candidates.some((prefix) => fingerprintMatches(prefix[i]!, actual));
    if (session.status !== 'ready') {
      allowed = allowed || fingerprintMatches(session.before[i]!, actual);
      if (!allowed && actual.kind === 'directory' && session.before[i]!.kind === 'absent') {
        const children = await fs.readDirectory(actual.path);
        const declared = new Set(
          paths.filter((path) => fs.dirname(path) === actual.path).map((path) => fs.basename(path)),
        );
        allowed = children.every((child) => declared.has(child));
      }
    }
    if (!allowed) changed.push(actual.path);
  }
  return changed;
}
export async function validateBenchmarkBackups(
  context: CommandContext,
  session: BenchmarkArmSession,
): Promise<void> {
  const fs = context.adapters!.fs;
  for (const snapshot of session.snapshots)
    if (snapshot.contentRef !== null) {
      const source = fs.join(
        context.stateRoot!,
        'backups',
        session.transactionId,
        snapshot.contentRef,
      );
      const fingerprint = await fileFingerprint(fs, source);
      if (
        fingerprint.digest !== snapshot.digest ||
        (await fs.stat(source))?.byteLength !== snapshot.byteLength
      )
        throw new Error(`Backup digest mismatch for ${snapshot.path}`);
    }
}

async function attemptBenchmarkRestoration(
  context: CommandContext,
  session: BenchmarkArmSession,
): Promise<CommandResult<BenchmarkRestoreReport | null>> {
  const command = 'benchmark-restore';
  const paths = session.before.map((f) => f.path);
  const data: BenchmarkRestoreReport = {
    benchmarkId: session.benchmarkId,
    variant: session.variant,
    status: 'planned',
    paths,
  };
  const refuse = (
    code: 5 | 7,
    message: string,
    blocked: string[] = paths,
  ): CommandResult<BenchmarkRestoreReport | null> =>
    commandResult({
      command,
      exitCode: code,
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-restoration-blocked',
          message,
          path: blocked[0] ?? null,
          remediation: `Preserve the backups and resolve the listed changes, then run benchmark-restore --benchmark-id ${session.benchmarkId} --variant ${session.variant} --yes`,
        }),
      ],
    });
  if (context.adapters === null || context.stateRoot === null)
    return refuse(5, 'Benchmark recovery storage is unavailable');
  const { fs } = context.adapters;
  if (session.projectId !== context.adapters.projectIdFor(context.projectRoot))
    return refuse(5, 'The recovery checkpoint belongs to another project');
  const lease = await readMutationLease(fs, context.stateRoot);
  if (lease === null) {
    const completed =
      session.status === 'restored'
        ? session
        : await readBenchmarkSession(context, session.benchmarkId, session.variant);
    if (completed?.status === 'restored' && completed.transactionId === session.transactionId)
      return commandResult({ command, exitCode: 0, data: { ...data, status: 'restored' } });
    return refuse(5, 'The checkpoint has no matching configuration lease');
  }
  if (
    lease.transactionId !== session.transactionId ||
    lease.projectId !== session.projectId ||
    lease.benchmarkId !== session.benchmarkId ||
    lease.variant !== session.variant
  )
    return refuse(5, 'Another configuration session holds the lease');
  const changed = await benchmarkSessionDrift(context.adapters.fs, session);
  if (changed.length > 0)
    return refuse(
      5,
      `Configuration changed outside the prepared arm; preserved: ${changed.join(', ')}`,
      changed,
    );
  if (!context.confirmed) return commandResult({ command, exitCode: 0, data });
  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId: session.transactionId,
    projectRoot: await repositoryRootForBackupSafety(context),
    now: context.now,
  });
  if (!creation.ok) return refuse(5, creation.diagnostics.map((d) => d.message).join('; '));
  session.status = 'restoring';
  await saveBenchmarkSession(context, session);
  const diagnostics: Diagnostic[] = [];
  try {
    const journals = new FileJournalStore({
      fs,
      journalRoot: fs.join(context.stateRoot, 'journals'),
      backupRoot: fs.join(context.stateRoot, 'backups'),
    });
    const journalPath = fs.join(context.stateRoot, 'journals', `${session.transactionId}.json`);
    let journal: TransactionJournal | null = null;
    if ((await fs.stat(journalPath)) !== null) {
      const bytes = await fs.readFile(journalPath);
      try {
        journal = JSON.parse(new TextDecoder().decode(bytes)) as TransactionJournal;
      } catch {
        if (fs.atomicWriteFile === undefined)
          throw new Error('Interrupted journal cannot be preserved atomically');
        await fs.atomicWriteFile(
          fs.join(
            context.stateRoot,
            'backups',
            session.transactionId,
            'interrupted-journal.content',
          ),
          bytes,
        );
        diagnostics.push(
          diagnostic({
            severity: 'warning',
            code: 'benchmark-interrupted-journal-recovered',
            message:
              'The interrupted journal was preserved; recovery uses the intact configuration checkpoint',
            remediation: null,
          }),
        );
      }
      if (
        journal !== null &&
        (journal.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
          journal.transactionId !== session.transactionId ||
          journal.planId !== session.planId ||
          journal.projectId !== session.projectId)
      )
        throw new Error('Transaction journal identity conflicts with the checkpoint');
    }
    // Validate every backup before the first restore, including corruption beyond the first file.
    await validateBenchmarkBackups(context, session);
    await creation.store.restoreAll(session.snapshots);
    const restored = await Promise.all(paths.map((path) => fileFingerprint(fs, path)));
    const failures = restored.filter(
      (actual, i) => !fingerprintMatches(session.before[i]!, actual),
    );
    if (failures.length > 0)
      throw new Error(`Restoration did not verify: ${failures.map((f) => f.path).join(', ')}`);
    if (journal === null)
      journal = {
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        transactionId: session.transactionId,
        planId: session.planId,
        projectId: session.projectId,
        projectRoot: context.projectRoot,
        startedAt: session.snapshots[0]?.capturedAt ?? context.now(),
        finishedAt: null,
        outcome: 'in-progress',
        entries: [],
        ownership: [],
        pinned: true,
        diagnostics: [],
      };
    journal.outcome = 'rolled-back';
    journal.ownership = [];
    journal.pinned = false;
    journal.finishedAt = context.now();
    await journals.write(journal);
    session.status = 'restored';
    await saveBenchmarkSession(context, session);
    await fs.remove(fs.join(context.stateRoot, MUTATION_LEASE_FILENAME));
    return commandResult({
      command,
      exitCode: 0,
      data: { ...data, status: 'restored' },
      diagnostics,
    });
  } catch (error) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'benchmark-restoration-incomplete',
        message: error instanceof Error ? error.message : 'Restoration failed',
        remediation: `Keep the checkpoint and backups for ${session.transactionId}; retry benchmark-restore after resolving the failure`,
      }),
    );
    return commandResult({
      command,
      exitCode: EXIT_CODES['apply-failed-dirty'],
      data: null,
      diagnostics: [
        ...diagnostics,
        diagnostic({
          severity: 'error',
          code: 'benchmark-recovery-paths',
          message: `${session.transactionId}: preserved paths ${paths.join(', ')}`,
          remediation: `Retry benchmark-restore --benchmark-id ${session.benchmarkId} --variant ${session.variant} --yes`,
        }),
      ],
    });
  }
}

export async function restoreBenchmarkSession(
  context: CommandContext,
  session: BenchmarkArmSession,
): Promise<CommandResult<BenchmarkRestoreReport | null>> {
  try {
    return await attemptBenchmarkRestoration(context, session);
  } catch {
    return commandResult({
      command: 'benchmark-restore',
      exitCode:
        context.confirmed && (session.status === 'restoring' || session.status === 'restored')
          ? 7
          : 5,
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-restoration-unavailable',
          message: `Recovery could not complete for ${session.transactionId}; preserved paths: ${session.before.map((f) => f.path).join(', ')}`,
          path: session.before[0]?.path ?? null,
          remediation: `Preserve the checkpoint and backups, then retry benchmark-restore --benchmark-id ${session.benchmarkId} --variant ${session.variant} --yes`,
        }),
      ],
    });
  }
}

export async function runBenchmarkRestore(
  context: CommandContext,
): Promise<CommandResult<BenchmarkRestoreReport | null>> {
  try {
    const session = await readBenchmarkSession(
      context,
      context.benchmarkId ?? '',
      context.benchmarkVariant ?? '',
    );
    if (session === null)
      return commandResult({
        command: 'benchmark-restore',
        exitCode: 2,
        data: null,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'benchmark-session-not-found',
            message: 'No prepared arm checkpoint exists',
            remediation: 'Use the same benchmark id and variant as benchmark-prepare',
          }),
        ],
      });
    return await restoreBenchmarkSession(context, session);
  } catch {
    return commandResult({
      command: 'benchmark-restore',
      exitCode: 5,
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-session-unreadable',
          message: 'The recovery checkpoint or lease cannot be read safely',
          remediation:
            'Inspect the preserved checkpoint and backups without overwriting configuration',
        }),
      ],
    });
  }
}

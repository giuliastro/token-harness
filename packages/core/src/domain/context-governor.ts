/**
 * Evidence-bound context policy — PLAN §19.2.
 *
 * The governor consumes bounded metadata only. It never receives transcript text, invokes a model,
 * edits a harness, or converts local byte counts into subscription allowance.
 */

import { harnessId, type HarnessId } from './ids.js';
import type { RecommendationEvidence } from './optimizer.js';

export type ContextGovernorAction =
  | 'keep'
  | 'mask'
  | 'summarize'
  | 'compact'
  | 'checkpoint'
  | 'fresh-session'
  | 'unknown';

export type ContextMaterialKind =
  | 'tool-output'
  | 'repository-read'
  | 'mcp-schema'
  | 'instruction'
  | 'task-state'
  | 'other';

export type ContextMaterialState =
  | 'current'
  | 'superseded'
  | 'condensable'
  | 'unresolved'
  | 'unknown';

export type ContextReductionAttribution = 'none' | 'rtk' | 'harnesstrim' | 'other' | 'unknown';
export type ContextTaskBoundary = 'continuing' | 'completed' | 'new-task' | 'unknown';
export type ContextValidationState = 'passing' | 'failing' | 'unresolved' | 'unknown';
export type ContextQualityState = 'passed' | 'regressed' | 'unknown';
export type ContextReuseState = 'efficient' | 'inefficient' | 'unknown';

/**
 * A content-free observation. byteLength is a measured local byte count for the material currently
 * presented to the harness; it is not a token count or a subscription-usage estimate.
 */
export interface ContextMaterialObservation {
  kind: ContextMaterialKind;
  state: ContextMaterialState;
  byteLength: number | null;
  reduction: ContextReductionAttribution;
}

export interface ContextGovernorInput {
  harnessId: HarnessId;
  pressure: 'low' | 'moderate' | 'high' | 'unknown';
  taskBoundary: ContextTaskBoundary;
  validation: ContextValidationState;
  quality: ContextQualityState;
  /** Explicit retry regression can veto summarization or compaction just like a quality regression. */
  retryRegression?: boolean;
  reuse: ContextReuseState;
  /** An explicit allowance/reset/task boundary that requires preserving durable state. */
  checkpointRequired?: boolean;
  /** Required before this engine recommends a checkpoint or compaction artifact. Minimum 256 B. */
  checkpointMaxBytes?: number | null;
  materials: readonly ContextMaterialObservation[];
}

/** Versioned metadata accepted from an active harness runtime. It intentionally omits pressure. */
export interface ContextGovernorSnapshot extends Omit<ContextGovernorInput, 'pressure'> {
  schemaVersion: 1;
}

export const CONTEXT_GOVERNOR_MAX_MATERIALS = 128;

const SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'harnessId',
  'taskBoundary',
  'validation',
  'quality',
  'retryRegression',
  'checkpointRequired',
  'reuse',
  'checkpointMaxBytes',
  'materials',
]);
const MATERIAL_KEYS = new Set(['kind', 'state', 'byteLength', 'reduction']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** Strict parser for bounded, content-free active-session observations. */
export function parseContextGovernorSnapshot(value: unknown): ContextGovernorSnapshot | null {
  if (!record(value) || !onlyKeys(value, SNAPSHOT_KEYS)) return null;
  if (
    value['schemaVersion'] !== 1 ||
    (value['harnessId'] !== 'claude' && value['harnessId'] !== 'codex') ||
    !oneOf(value['taskBoundary'], ['continuing', 'completed', 'new-task', 'unknown'] as const) ||
    !oneOf(value['validation'], ['passing', 'failing', 'unresolved', 'unknown'] as const) ||
    !oneOf(value['quality'], ['passed', 'regressed', 'unknown'] as const) ||
    !oneOf(value['reuse'], ['efficient', 'inefficient', 'unknown'] as const) ||
    !Array.isArray(value['materials']) ||
    value['materials'].length > CONTEXT_GOVERNOR_MAX_MATERIALS
  )
    return null;

  const retryRegression = value['retryRegression'];
  const checkpointRequired = value['checkpointRequired'];
  const checkpointMaxBytes = value['checkpointMaxBytes'];

  if (
    ('retryRegression' in value && typeof value['retryRegression'] !== 'boolean') ||
    ('checkpointRequired' in value && typeof value['checkpointRequired'] !== 'boolean') ||
    ('checkpointMaxBytes' in value &&
      value['checkpointMaxBytes'] !== null &&
      (typeof value['checkpointMaxBytes'] !== 'number' ||
        !Number.isSafeInteger(value['checkpointMaxBytes']) ||
        value['checkpointMaxBytes'] < MIN_CHECKPOINT_BYTES))
  )
    return null;

  const materials: ContextMaterialObservation[] = [];
  for (const item of value['materials']) {
    if (
      !record(item) ||
      !onlyKeys(item, MATERIAL_KEYS) ||
      !oneOf(item['kind'], [
        'tool-output',
        'repository-read',
        'mcp-schema',
        'instruction',
        'task-state',
        'other',
      ] as const) ||
      !oneOf(item['state'], [
        'current',
        'superseded',
        'condensable',
        'unresolved',
        'unknown',
      ] as const) ||
      !oneOf(item['reduction'], ['none', 'rtk', 'harnesstrim', 'other', 'unknown'] as const) ||
      (item['byteLength'] !== null &&
        (typeof item['byteLength'] !== 'number' ||
          !Number.isSafeInteger(item['byteLength']) ||
          item['byteLength'] < 0))
    )
      return null;

    materials.push({
      kind: item['kind'],
      state: item['state'],
      byteLength: item['byteLength'] as number | null,
      reduction: item['reduction'],
    });
  }

  return {
    schemaVersion: 1,
    harnessId: harnessId(value['harnessId']),
    taskBoundary: value['taskBoundary'],
    validation: value['validation'],
    quality: value['quality'],
    ...(retryRegression === undefined ? {} : { retryRegression: retryRegression as boolean }),
    reuse: value['reuse'],
    ...(checkpointRequired === undefined
      ? {}
      : { checkpointRequired: checkpointRequired as boolean }),
    ...(checkpointMaxBytes === undefined
      ? {}
      : { checkpointMaxBytes: checkpointMaxBytes as number | null }),
    materials,
  };
}

export interface ContextMaterialRecommendation {
  kind: ContextMaterialKind;
  action: 'keep' | 'mask' | 'summarize' | 'unknown';
  byteLength: number | null;
  evidence: RecommendationEvidence;
}

export interface ContextGovernorDecision {
  harnessId: HarnessId;
  action: ContextGovernorAction;
  /** Sum of measured local bytes only; never a context-token or allowance estimate. */
  observedBytes: number;
  /** Measured bytes attached to explicit mask/summarize recommendations. */
  actionableBytes: number;
  /** Null when no valid hard artifact-size ceiling was supplied. */
  checkpointMaxBytes: number | null;
  materials: ContextMaterialRecommendation[];
  evidence: RecommendationEvidence[];
}

const MIN_CHECKPOINT_BYTES = 256;
const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

function validBytes(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function sumBytes(values: readonly number[]): number {
  return values.reduce((total, value) => Math.min(SAFE_INTEGER_MAX, total + value), 0);
}

function validCheckpointBudget(value: number | null | undefined): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= MIN_CHECKPOINT_BYTES
  );
}

function materialDecision(
  item: ContextMaterialObservation,
  input: ContextGovernorInput,
): ContextMaterialRecommendation {
  const bytes = validBytes(item.byteLength) ? item.byteLength : null;
  const hold = (code: string, summary: string): ContextMaterialRecommendation => ({
    kind: item.kind,
    action: 'keep',
    byteLength: bytes,
    evidence: { code, summary },
  });
  const blocked =
    input.quality === 'regressed' ||
    input.retryRegression === true ||
    input.validation === 'failing' ||
    input.validation === 'unresolved';

  if (item.state === 'current' || item.state === 'unresolved') {
    return hold(
      'context-material-preserved',
      item.state === 'unresolved'
        ? 'Preserve material tied to unresolved task state or validation'
        : 'Preserve material marked current for the active task',
    );
  }
  if (item.state === 'unknown' || bytes === null || bytes === 0) {
    return {
      kind: item.kind,
      action: 'unknown',
      byteLength: bytes,
      evidence: {
        code: 'context-material-unmeasured',
        summary:
          'Material state or local byte size is not sufficiently observed for a context action',
      },
    };
  }
  if (blocked) {
    return hold(
      'context-quality-veto',
      input.quality === 'regressed' || input.retryRegression === true
        ? 'Keep material because observed quality or retry regression vetoes aggressive context reduction'
        : 'Keep material while validation is failing or unresolved',
    );
  }
  if (
    item.state === 'superseded' &&
    (item.kind === 'tool-output' || item.kind === 'repository-read')
  ) {
    return {
      kind: item.kind,
      action: 'mask',
      byteLength: bytes,
      evidence: {
        code: 'context-superseded-material',
        summary:
          String(bytes) +
          ' measured bytes of superseded tool or repository output can be deterministically masked',
      },
    };
  }
  if (item.state === 'condensable') {
    if (item.reduction !== 'none') {
      return hold(
        'context-reduction-already-attributed',
        'Do not summarize this material again because a reducer already transformed it or reduction state is unknown',
      );
    }
    return {
      kind: item.kind,
      action: 'summarize',
      byteLength: bytes,
      evidence: {
        code: 'context-durable-material-condensable',
        summary:
          String(bytes) +
          ' measured bytes are marked durable and condensable; preserve the facts at lower fidelity',
      },
    };
  }
  return hold(
    'context-material-preserved',
    'Keep material because no reviewed masking or summarization rule applies to this category',
  );
}

/** Classify only explicitly observed material and task-boundary evidence. */
export function decideContextGovernor(input: ContextGovernorInput): ContextGovernorDecision {
  const materials = input.materials
    .map((item) => materialDecision(item, input))
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.action.localeCompare(right.action) ||
        (left.byteLength ?? -1) - (right.byteLength ?? -1),
    );
  const observedBytes = sumBytes(
    materials.flatMap((item) => (item.byteLength === null ? [] : [item.byteLength])),
  );
  const actionableBytes = sumBytes(
    materials.flatMap((item) =>
      item.byteLength !== null && (item.action === 'mask' || item.action === 'summarize')
        ? [item.byteLength]
        : [],
    ),
  );
  const checkpointMaxBytes = validCheckpointBudget(input.checkpointMaxBytes)
    ? input.checkpointMaxBytes
    : null;
  const taskBoundary = input.taskBoundary === 'completed' || input.taskBoundary === 'new-task';
  const unresolvedTaskState =
    input.validation !== 'passing' ||
    input.quality === 'regressed' ||
    input.retryRegression === true ||
    input.materials.some((item) => item.state === 'unresolved');
  const checkpointRequired =
    input.checkpointRequired === true || (taskBoundary && unresolvedTaskState);
  const hasAction = (action: ContextMaterialRecommendation['action']) =>
    materials.some((item) => item.action === action);
  const evidence: RecommendationEvidence[] = materials.map((item) => item.evidence);

  let action: ContextGovernorAction;
  if (checkpointRequired) {
    if (checkpointMaxBytes === null) {
      action = 'unknown';
      evidence.push({
        code: 'context-checkpoint-budget-missing',
        summary: 'A required checkpoint has no valid configured byte ceiling of at least 256 bytes',
      });
    } else {
      action = 'checkpoint';
      evidence.push({
        code: 'context-checkpoint-required',
        summary:
          'Preserve durable task state before the observed boundary within ' +
          String(checkpointMaxBytes) +
          ' bytes',
      });
    }
  } else if (
    input.taskBoundary === 'completed' &&
    input.validation === 'passing' &&
    input.quality !== 'regressed'
  ) {
    action = 'fresh-session';
    evidence.push({
      code: 'context-task-complete',
      summary: 'The task is complete and validation passed; begin the next task in a fresh session',
    });
  } else if (
    input.taskBoundary === 'new-task' &&
    input.reuse === 'inefficient' &&
    input.validation === 'passing' &&
    input.quality !== 'regressed'
  ) {
    action = 'fresh-session';
    evidence.push({
      code: 'context-new-task-low-reuse',
      summary: 'The next task has low reuse value for the observed context; start a fresh session',
    });
  } else if (hasAction('mask')) {
    action = 'mask';
  } else if (hasAction('summarize')) {
    action = 'summarize';
  } else if (
    input.taskBoundary === 'continuing' &&
    input.reuse === 'inefficient' &&
    input.quality !== 'regressed' &&
    input.retryRegression !== true &&
    input.validation !== 'failing' &&
    input.validation !== 'unresolved'
  ) {
    if (checkpointMaxBytes === null) {
      action = 'unknown';
      evidence.push({
        code: 'context-compaction-budget-missing',
        summary: 'Compaction needs a valid configured artifact byte ceiling of at least 256 bytes',
      });
    } else {
      action = 'compact';
      evidence.push({
        code: 'context-reuse-inefficient',
        summary:
          'The same task continues with explicitly inefficient history; compact durable state within ' +
          String(checkpointMaxBytes) +
          ' bytes',
      });
    }
  } else if (input.pressure === 'low') {
    action = 'keep';
    evidence.push({
      code: 'context-pressure-low',
      summary: 'Observed context pressure is low and no material-specific reduction is supported',
    });
  } else {
    action = 'unknown';
    evidence.push({
      code: 'context-material-evidence-incomplete',
      summary:
        'Context pressure or task state alone does not identify safe material to remove or condense',
    });
  }

  return {
    harnessId: input.harnessId,
    action,
    observedBytes,
    actionableBytes,
    checkpointMaxBytes,
    materials,
    evidence,
  };
}

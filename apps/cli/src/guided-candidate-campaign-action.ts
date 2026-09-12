import { isTaskBenchmarkId, type TaskQualityGate } from '@token-harness/core';

import {
  createGuideCandidateCampaignReader,
  parseGuideCandidateCampaignRequest,
  type GuideCandidateCampaignRequest,
  type GuideCandidateCampaignStatus,
  type GuideCandidateCampaignStepKind,
} from './guided-candidate-campaign-status.js';
import type { GuideCall } from './guided.js';

export type GuideCandidateCampaignMutableStep = Exclude<
  GuideCandidateCampaignStepKind,
  'complete' | 'invalid'
>;

export interface GuideCandidateCampaignOutcome {
  quality: TaskQualityGate;
  attempts: number;
  failedAttempts: number;
}

export interface GuideCandidateCampaignActionRequest extends GuideCandidateCampaignRequest {
  expectedKind: GuideCandidateCampaignMutableStep;
  expectedBenchmarkId: string;
  activationAcknowledged: boolean;
  outcome: GuideCandidateCampaignOutcome | null;
}

export type GuideCandidateCampaignActionResult =
  | {
      ok: true;
      performed: GuideCandidateCampaignMutableStep;
      status: GuideCandidateCampaignStatus;
    }
  | {
      ok: false;
      statusCode: 400 | 409;
      error: string;
      status: GuideCandidateCampaignStatus | null;
    };

const MUTABLE_STEPS = new Set<GuideCandidateCampaignMutableStep>([
  'start-baseline',
  'finish-baseline',
  'start-optimized',
  'finish-optimized',
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function parseOutcome(value: unknown): GuideCandidateCampaignOutcome | null {
  if (!plainObject(value) || !exactKeys(value, ['quality', 'attempts', 'failedAttempts'])) return null;
  const quality = value['quality'];
  const attempts = value['attempts'];
  const failedAttempts = value['failedAttempts'];
  if (
    (quality !== 'passed' && quality !== 'failed') ||
    !Number.isInteger(attempts) ||
    !Number.isInteger(failedAttempts) ||
    (attempts as number) < 1 ||
    (failedAttempts as number) < 0 ||
    (failedAttempts as number) > (attempts as number)
  ) {
    return null;
  }
  return {
    quality,
    attempts: attempts as number,
    failedAttempts: failedAttempts as number,
  };
}

export function parseGuideCandidateCampaignActionRequest(
  value: unknown,
): GuideCandidateCampaignActionRequest | null {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'candidateId',
      'harnessId',
      'campaignId',
      'expectedKind',
      'expectedBenchmarkId',
      'activationAcknowledged',
      'outcome',
    ])
  ) {
    return null;
  }

  const candidateId = value['candidateId'];
  const harnessId = value['harnessId'];
  const campaignId = value['campaignId'];
  const expectedKind = value['expectedKind'];
  const expectedBenchmarkId = value['expectedBenchmarkId'];
  const activationAcknowledged = value['activationAcknowledged'];

  if (
    typeof candidateId !== 'string' ||
    typeof harnessId !== 'string' ||
    typeof campaignId !== 'string' ||
    typeof expectedKind !== 'string' ||
    !MUTABLE_STEPS.has(expectedKind as GuideCandidateCampaignMutableStep) ||
    typeof expectedBenchmarkId !== 'string' ||
    !isTaskBenchmarkId(expectedBenchmarkId) ||
    typeof activationAcknowledged !== 'boolean'
  ) {
    return null;
  }

  const campaign = parseGuideCandidateCampaignRequest(
    new URLSearchParams({
      candidate: candidateId,
      harness: harnessId,
      campaign: campaignId,
    }),
  );
  if (campaign === null) return null;

  const finish = expectedKind === 'finish-baseline' || expectedKind === 'finish-optimized';
  const outcome = value['outcome'] === null ? null : parseOutcome(value['outcome']);
  if ((finish && outcome === null) || (!finish && value['outcome'] !== null)) return null;

  return {
    ...campaign,
    expectedKind: expectedKind as GuideCandidateCampaignMutableStep,
    expectedBenchmarkId,
    activationAcknowledged,
    outcome,
  };
}

function stale(
  status: GuideCandidateCampaignStatus,
): GuideCandidateCampaignActionResult {
  return {
    ok: false,
    statusCode: 409,
    error: 'Campaign state changed. Refresh the step before recording anything.',
    status,
  };
}

function startArgs(
  request: GuideCandidateCampaignActionRequest,
  status: GuideCandidateCampaignStatus,
): string[] | null {
  const step = status.nextStep;
  if (step === null || step.benchmarkId === null || step.taskClass === null) return null;
  const variant = step.kind === 'start-baseline' ? 'baseline' : 'optimized';
  return [
    'benchmark-start',
    '--benchmark-id',
    step.benchmarkId,
    '--candidate',
    request.candidateId,
    '--variant',
    variant,
    '--task',
    step.taskClass,
    '--harness',
    request.harnessId,
  ];
}

function finishArgs(
  request: GuideCandidateCampaignActionRequest,
  status: GuideCandidateCampaignStatus,
): string[] | null {
  const step = status.nextStep;
  const outcome = request.outcome;
  if (step === null || step.benchmarkId === null || outcome === null) return null;
  const variant = step.kind === 'finish-baseline' ? 'baseline' : 'optimized';
  return [
    'benchmark-finish',
    '--benchmark-id',
    step.benchmarkId,
    '--variant',
    variant,
    '--quality',
    outcome.quality,
    '--attempts',
    String(outcome.attempts),
    '--failed-attempts',
    String(outcome.failedAttempts),
  ];
}

export function createGuideCandidateCampaignActionRunner(
  call: GuideCall,
): (request: GuideCandidateCampaignActionRequest) => Promise<GuideCandidateCampaignActionResult> {
  const read = createGuideCandidateCampaignReader(call);
  return async (request) => {
    const status = await read(request);
    if (!status.available || status.nextStep === null) return stale(status);
    const step = status.nextStep;
    if (
      step.kind !== request.expectedKind ||
      step.benchmarkId === null ||
      step.benchmarkId !== request.expectedBenchmarkId ||
      step.kind === 'complete' ||
      step.kind === 'invalid'
    ) {
      return stale(status);
    }

    if (step.kind === 'start-optimized' && !request.activationAcknowledged) {
      return {
        ok: false,
        statusCode: 400,
        error:
          'Confirm that you enabled the candidate through its own documented workflow before starting the optimized capture. This acknowledgement is not activation verification.',
        status,
      };
    }

    const args =
      step.kind === 'start-baseline' || step.kind === 'start-optimized'
        ? startArgs(request, status)
        : finishArgs(request, status);
    if (args === null) return stale(status);

    const result = await call<unknown>(args);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        statusCode: 409,
        error:
          'The benchmark step was not recorded. Refresh the campaign state before trying again.',
        status: await read(request),
      };
    }

    return {
      ok: true,
      performed: request.expectedKind,
      status: await read(request),
    };
  };
}

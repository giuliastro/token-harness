import type { TaskClass } from '@token-harness/core';

import type {
  CandidateAwareBenchmarkMatrixReport,
  CandidateBenchmarkCampaignReport,
  CandidateBenchmarkCampaignSlot,
} from './commands/candidate-benchmark.js';
import type { CandidateEvidenceSignal } from './commands/candidate-evidence-assessment.js';
import {
  createGuideCandidateCampaignActionRunner,
  type GuideCandidateCampaignActionRequest,
  type GuideCandidateCampaignActionResult,
} from './guided-candidate-campaign-action.js';
import type { GuideCall } from './guided.js';

export type GuideCandidateId = 'headroom' | 'mcptoon' | 'gitnexus';
export type GuideCandidateHarness = 'claude' | 'codex';
export type GuideCandidateCampaignStepKind =
  | 'start-baseline'
  | 'finish-baseline'
  | 'start-optimized'
  | 'finish-optimized'
  | 'complete'
  | 'invalid';

export interface GuideCandidateCampaignRequest {
  candidateId: GuideCandidateId;
  harnessId: GuideCandidateHarness;
  campaignId: string;
}

export interface GuideCandidateCampaignStep {
  kind: GuideCandidateCampaignStepKind;
  benchmarkId: string | null;
  taskClass: TaskClass | null;
  run: number | null;
  requiresActivationAcknowledgement: boolean;
}

export interface GuideCandidateCampaignStatus {
  available: boolean;
  campaignId: string;
  candidateId: GuideCandidateId;
  harnessId: GuideCandidateHarness;
  completedPairs: number;
  totalPairs: number;
  invalidPairs: number;
  progressPercent: number;
  signal: CandidateEvidenceSignal | 'unavailable';
  decisionReady: boolean;
  evidencePairs: number;
  evidenceCoveragePercent: number | null;
  minimumEvidencePairs: number | null;
  minimumTaskClasses: number | null;
  minimumEvidenceCoveragePercent: number | null;
  coveredTaskClasses: TaskClass[];
  optimizedBetter: number;
  baselineBetter: number;
  equivalent: number;
  localComparablePairs: number;
  localTokenSavingPercent: number | null;
  wallClockComparablePairs: number;
  wallClockSavingPercent: number | null;
  hardRegressionPairs: number;
  nextStep: GuideCandidateCampaignStep | null;
  nextCommand: string | null;
  nextInstruction: string;
  reasons: string[];
  promotionEligible: false;
  promotionBlockers: string[];
  note: string;
}

export interface GuideCandidateCampaignController {
  (input: GuideCandidateCampaignRequest): Promise<GuideCandidateCampaignStatus>;
  action(input: GuideCandidateCampaignActionRequest): Promise<GuideCandidateCampaignActionResult>;
}

const CANDIDATES = new Set<GuideCandidateId>(['headroom', 'mcptoon', 'gitnexus']);
const HARNESSES = new Set<GuideCandidateHarness>(['claude', 'codex']);
const CAMPAIGN_SUFFIX = /^[a-z0-9]{1,32}$/;

export function parseGuideCandidateCampaignRequest(
  params: URLSearchParams,
): GuideCandidateCampaignRequest | null {
  const candidate = params.get('candidate');
  const harness = params.get('harness');
  const campaign = params.get('campaign');
  if (
    candidate === null ||
    harness === null ||
    campaign === null ||
    !CANDIDATES.has(candidate as GuideCandidateId) ||
    !HARNESSES.has(harness as GuideCandidateHarness)
  ) {
    return null;
  }
  const candidateId = candidate as GuideCandidateId;
  const harnessId = harness as GuideCandidateHarness;
  const prefix = `${candidateId}-${harnessId}-eval-`;
  if (!campaign.startsWith(prefix) || !CAMPAIGN_SUFFIX.test(campaign.slice(prefix.length))) {
    return null;
  }
  return { candidateId, harnessId, campaignId: campaign };
}

function unavailable(input: GuideCandidateCampaignRequest): GuideCandidateCampaignStatus {
  return {
    available: false,
    ...input,
    completedPairs: 0,
    totalPairs: 0,
    invalidPairs: 0,
    progressPercent: 0,
    signal: 'unavailable',
    decisionReady: false,
    evidencePairs: 0,
    evidenceCoveragePercent: null,
    minimumEvidencePairs: null,
    minimumTaskClasses: null,
    minimumEvidenceCoveragePercent: null,
    coveredTaskClasses: [],
    optimizedBetter: 0,
    baselineBetter: 0,
    equivalent: 0,
    localComparablePairs: 0,
    localTokenSavingPercent: null,
    wallClockComparablePairs: 0,
    wallClockSavingPercent: null,
    hardRegressionPairs: 0,
    nextStep: null,
    nextCommand: null,
    nextInstruction:
      'Campaign evidence could not be read. No automatic retry or candidate activation was attempted.',
    reasons: [],
    promotionEligible: false,
    promotionBlockers: [],
    note: 'Campaign evidence is selection evidence only. Candidate activation and promotion remain separate checks.',
  };
}

function activeSlot(
  campaign: CandidateBenchmarkCampaignReport,
): CandidateBenchmarkCampaignSlot | null {
  return campaign.slots.find((slot) => slot.state !== 'complete') ?? null;
}

function campaignStep(campaign: CandidateBenchmarkCampaignReport): GuideCandidateCampaignStep {
  const slot = activeSlot(campaign);
  if (slot === null) {
    return {
      kind: 'complete',
      benchmarkId: null,
      taskClass: null,
      run: null,
      requiresActivationAcknowledgement: false,
    };
  }

  const kind: GuideCandidateCampaignStepKind =
    slot.state === 'baseline-not-started'
      ? 'start-baseline'
      : slot.state === 'baseline-running'
        ? 'finish-baseline'
        : slot.state === 'optimized-not-started'
          ? 'start-optimized'
          : slot.state === 'optimized-running'
            ? 'finish-optimized'
            : 'invalid';

  return {
    kind,
    benchmarkId: slot.benchmarkId,
    taskClass: slot.taskClass,
    run: slot.run,
    requiresActivationAcknowledgement: kind === 'start-optimized',
  };
}

export function createGuideCandidateCampaignReader(
  call: GuideCall,
): GuideCandidateCampaignController {
  const read = async (
    input: GuideCandidateCampaignRequest,
  ): Promise<GuideCandidateCampaignStatus> => {
    const result = await call<CandidateAwareBenchmarkMatrixReport>([
      'benchmark-matrix',
      '--benchmark-id',
      input.campaignId,
      '--candidate',
      input.candidateId,
      '--harness',
      input.harnessId,
    ]);
    const campaign = result.data?.campaign;
    if (
      campaign === undefined ||
      campaign.campaignId !== input.campaignId ||
      campaign.candidateId !== input.candidateId ||
      campaign.harnessId !== input.harnessId
    ) {
      return unavailable(input);
    }

    const totalPairs = campaign.totalPairs;
    return {
      available: true,
      ...input,
      completedPairs: campaign.completedPairs,
      totalPairs,
      invalidPairs: campaign.invalidPairs,
      progressPercent:
        totalPairs === 0 ? 0 : Math.round((campaign.completedPairs / totalPairs) * 100),
      signal: campaign.assessment.signal,
      decisionReady: campaign.assessment.decisionReady,
      evidencePairs: campaign.assessment.evidencePairs,
      evidenceCoveragePercent: campaign.evidence.evidenceCoveragePercent,
      minimumEvidencePairs: campaign.assessment.minimumEvidencePairs,
      minimumTaskClasses: campaign.assessment.minimumTaskClasses,
      minimumEvidenceCoveragePercent: campaign.assessment.minimumEvidenceCoveragePercent,
      coveredTaskClasses: [...campaign.assessment.coveredTaskClasses],
      optimizedBetter: campaign.evidence.optimizedBetter,
      baselineBetter: campaign.evidence.baselineBetter,
      equivalent: campaign.evidence.equivalent,
      localComparablePairs: campaign.evidence.localComparablePairs,
      localTokenSavingPercent: campaign.evidence.localTokenSavingPercent,
      wallClockComparablePairs: campaign.evidence.wallClockComparablePairs,
      wallClockSavingPercent: campaign.evidence.wallClockSavingPercent,
      hardRegressionPairs: campaign.assessment.hardRegressionPairs,
      nextStep: campaignStep(campaign),
      nextCommand: campaign.nextCommand,
      nextInstruction: campaign.nextInstruction,
      reasons: [...campaign.assessment.reasons],
      promotionEligible: false,
      promotionBlockers: [...campaign.assessment.promotionBlockers],
      note: 'Campaign evidence is selection evidence only. Candidate attribution does not prove activation, and decision-ready does not mean promotion-ready.',
    };
  };

  const controller = read as GuideCandidateCampaignController;
  controller.action = createGuideCandidateCampaignActionRunner(call, read);
  return controller;
}

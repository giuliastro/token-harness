import type { TaskClass } from '@token-harness/core';

import type { CandidateAwareBenchmarkMatrixReport } from './commands/candidate-benchmark.js';
import type { CandidateEvidenceSignal } from './commands/candidate-evidence-assessment.js';
import type { GuideCall } from './guided.js';

export type GuideCandidateId = 'headroom' | 'mcptoon' | 'gitnexus';
export type GuideCandidateHarness = 'claude' | 'codex';

export interface GuideCandidateCampaignRequest {
  candidateId: GuideCandidateId;
  harnessId: GuideCandidateHarness;
  campaignId: string;
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
  coveredTaskClasses: TaskClass[];
  nextCommand: string | null;
  nextInstruction: string;
  reasons: string[];
  promotionEligible: false;
  note: string;
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
    coveredTaskClasses: [],
    nextCommand: null,
    nextInstruction:
      'Campaign evidence could not be read. No automatic retry or candidate activation was attempted.',
    reasons: [],
    promotionEligible: false,
    note: 'Campaign evidence is selection evidence only. Candidate activation and promotion remain separate checks.',
  };
}

export function createGuideCandidateCampaignReader(
  call: GuideCall,
): (input: GuideCandidateCampaignRequest) => Promise<GuideCandidateCampaignStatus> {
  return async (input) => {
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
      coveredTaskClasses: [...campaign.assessment.coveredTaskClasses],
      nextCommand: campaign.nextCommand,
      nextInstruction: campaign.nextInstruction,
      reasons: [...campaign.assessment.reasons],
      promotionEligible: false,
      note: 'Campaign evidence is selection evidence only. Candidate attribution does not prove activation, and decision-ready does not mean promotion-ready.',
    };
  };
}

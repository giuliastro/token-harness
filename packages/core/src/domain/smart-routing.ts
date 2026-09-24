/**
 * Local, explainable model-routing classifier.
 *
 * This function is intentionally self-contained: the CCR adapter serializes its compiled
 * JavaScript body into a CCR Node.js script rule, so the classifier running in CCR is the same
 * implementation tested here. The prompt is inspected in memory and is never returned.
 */

export const SMART_ROUTING_CLASSIFIER_VERSION = 'heuristic-v1';

export const SMART_ROUTING_TIERS = ['simple', 'standard', 'complex', 'critical'] as const;
export type SmartRoutingTier = (typeof SMART_ROUTING_TIERS)[number];

export type SmartRoutingConfidence = 'low' | 'medium' | 'high';

export interface SmartRoutingPromptInput {
  text: string;
  hasImage?: boolean;
  toolCount?: number;
  inputTokens?: number;
}

export interface SmartRoutingClassification {
  classifierVersion: typeof SMART_ROUTING_CLASSIFIER_VERSION;
  tier: SmartRoutingTier;
  score: number;
  confidence: SmartRoutingConfidence;
  reasonCodes: string[];
  promptChars: number;
  wordCount: number;
  codePresent: boolean;
  technicalTermCount: number;
  reasoningMarkerCount: number;
  multiStep: boolean;
  hasImage: boolean;
  toolCount: number;
  conservativeEligible: boolean;
}

/**
 * Deterministic heuristics inspired by LiteLLM Auto Router v2's local complexity scorer.
 *
 * Keep this function free of module-level references. CCR runs it in an isolated script worker
 * without Token Harness imports, while local tests call this exact function directly.
 */
export function classifySmartRoutingPrompt(
  input: SmartRoutingPromptInput,
): SmartRoutingClassification {
  const original = typeof input.text === 'string' ? input.text : '';
  const text = original.trim();
  const normalized = text.toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const wordCount = words.length;
  const hasImage = input.hasImage === true;
  const toolCount =
    Number.isSafeInteger(input.toolCount) && (input.toolCount ?? 0) > 0
      ? (input.toolCount as number)
      : 0;

  const codePresent =
    /```|(?:^|\n)\s*(?:function|class|interface|type|import|export|const|let|var)\s+\w/m.test(
      text,
    ) ||
    /\b(?:stack trace|traceback|SELECT\s+.+\s+FROM|npm ERR!|TS\d{3,5})\b/i.test(text) ||
    /(?:=>|\b\w+\([^\n)]*\)\s*\{|\b(?:def|fn)\s+\w+\s*\()/m.test(text);

  const technicalTerms = [
    'api',
    'architecture',
    'async',
    'authentication',
    'database',
    'distributed',
    'encryption',
    'filesystem',
    'invariant',
    'migration',
    'network',
    'parallel',
    'protocol',
    'race condition',
    'regression',
    'security',
    'sql',
    'thread',
    'transaction',
    'typescript',
  ];
  let technicalTermCount = 0;
  for (const term of technicalTerms) {
    if (normalized.includes(term)) technicalTermCount += 1;
  }

  const reasoningMarkers = [
    'analyze',
    'analyse',
    'compare',
    'debug',
    'design',
    'evaluate',
    'investigate',
    'optimize',
    'reason through',
    'root cause',
    'trade-off',
    'tradeoff',
    'why',
    'step by step',
  ];
  let reasoningMarkerCount = 0;
  for (const marker of reasoningMarkers) {
    if (normalized.includes(marker)) reasoningMarkerCount += 1;
  }

  const simpleIndicator =
    /^(?:hi|hello|hey|thanks|thank you|define\b|what is\b|what does\b|translate\b|rewrite\b|fix typo\b|format\b|summarize\b|summarise\b)/i.test(
      text,
    );
  const multiStep =
    /\b(?:first|then|finally|step\s+\d+|in\s+three\s+steps)\b/i.test(text) ||
    /(?:^|\n)\s*\d+[.)]\s+\S/m.test(text) ||
    /\b(?:and then|after that|before you)\b/i.test(text);
  const questionCount = (text.match(/\?/g) ?? []).length;
  const longPrompt =
    wordCount >= 100 || (Number.isFinite(input.inputTokens) && (input.inputTokens ?? 0) >= 1200);
  const veryLongPrompt =
    wordCount >= 300 || (Number.isFinite(input.inputTokens) && (input.inputTokens ?? 0) >= 5000);

  const reasonCodes: string[] = [];
  let score = 0;

  if (wordCount > 0 && wordCount <= 12) {
    score -= 1.5;
    reasonCodes.push('short-prompt');
  } else if (wordCount >= 30 && wordCount < 100) {
    score += 0.5;
    reasonCodes.push('medium-prompt');
  } else if (longPrompt) {
    score += 1.5;
    reasonCodes.push('long-prompt');
  }
  if (veryLongPrompt) {
    score += 1;
    reasonCodes.push('very-long-prompt');
  }
  if (codePresent) {
    score += 2.5;
    reasonCodes.push('code-present');
  }
  if (technicalTermCount > 0) {
    score += Math.min(technicalTermCount, 3) * 0.75;
    reasonCodes.push('technical-terms');
  }
  if (reasoningMarkerCount > 0) {
    score += reasoningMarkerCount >= 2 ? 3.5 : 1.5;
    reasonCodes.push(reasoningMarkerCount >= 2 ? 'multiple-reasoning-markers' : 'reasoning-marker');
  }
  if (multiStep) {
    score += 1.5;
    reasonCodes.push('multi-step-request');
  }
  if (questionCount > 1) {
    score += Math.min(questionCount - 1, 3) * 0.5;
    reasonCodes.push('multiple-questions');
  }
  if (simpleIndicator) {
    score -= 2;
    reasonCodes.push('simple-language-indicator');
  }
  if (hasImage) {
    score += 3;
    reasonCodes.push('image-input');
  }
  if (wordCount === 0) reasonCodes.push('empty-user-text');
  if (toolCount > 0) reasonCodes.push('tool-schema-present');

  const shortFollowUp = wordCount > 0 && wordCount <= 4 && !simpleIndicator;
  if (shortFollowUp) {
    // A terse follow-up can depend on expensive prior context that CCR does not expose here.
    score = Math.max(score, 0.25);
    reasonCodes.push('possible-contextual-follow-up');
  }

  let tier: SmartRoutingTier;
  if (hasImage) tier = 'complex';
  else if (reasoningMarkerCount >= 2 || score >= 5) tier = 'critical';
  else if (codePresent || technicalTermCount >= 2 || score >= 1.75) tier = 'complex';
  else if (score <= -1.25 && simpleIndicator && !shortFollowUp) tier = 'simple';
  else tier = 'standard';

  const boundaries = [-1.25, 1.75, 5];
  let boundaryDistance = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries)
    boundaryDistance = Math.min(boundaryDistance, Math.abs(score - boundary));
  const signalCount = reasonCodes.length;
  const confidence: SmartRoutingConfidence =
    wordCount === 0
      ? 'low'
      : signalCount >= 2 && boundaryDistance >= 1.25 && tier !== 'standard'
        ? 'high'
        : signalCount >= 1 && boundaryDistance >= 0.5
          ? 'medium'
          : 'low';

  const conservativeEligible =
    tier === 'simple' &&
    confidence === 'high' &&
    simpleIndicator &&
    !codePresent &&
    technicalTermCount === 0 &&
    reasoningMarkerCount === 0 &&
    !multiStep &&
    questionCount <= 1 &&
    !hasImage &&
    text.length <= 320;

  return {
    classifierVersion: 'heuristic-v1',
    tier,
    score: Math.round(score * 100) / 100,
    confidence,
    reasonCodes,
    promptChars: text.length,
    wordCount,
    codePresent,
    technicalTermCount,
    reasoningMarkerCount,
    multiStep,
    hasImage,
    toolCount,
    conservativeEligible,
  };
}

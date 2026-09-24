import {
  SMART_ROUTING_CLASSIFIER_VERSION,
  classifySmartRoutingPrompt,
  type SmartRoutingHarness,
  type SmartRoutingMode,
} from '@token-harness/core';

export interface CcrSmartRoutingScriptOptions {
  harnessId: SmartRoutingHarness;
  mode?: SmartRoutingMode;
  telemetryDirectory: string;
  pathSeparator: '/' | '\\';
  /** Optional model selected from an already configured CCR provider; never inferred from names. */
  simpleModel?: string | null;
}

/**
 * Build a CCR Node.js script-rule body from the exact core classifier used by Token Harness.
 * CCR supplies `input` and `api` to this body. Shadow is the default and returns `null`, leaving
 * CCR's existing route untouched. The script stores feature-only decision records locally.
 */
export function createCcrSmartRoutingScript(options: CcrSmartRoutingScriptOptions): string {
  const mode = options.mode ?? 'shadow';
  const eventPathPrefix = `${options.telemetryDirectory}${options.pathSeparator}`;
  const classifierSource = classifySmartRoutingPrompt.toString();
  const eventSchemaVersion = 2;
  const classifierVersion = SMART_ROUTING_CLASSIFIER_VERSION;
  const configuredSimpleModel =
    typeof options.simpleModel === 'string' &&
    /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(options.simpleModel)
      ? options.simpleModel
      : null;

  return `const classifySmartRoutingPrompt = (${classifierSource});
const telemetryPathPrefix = ${JSON.stringify(eventPathPrefix)};
const harnessId = ${JSON.stringify(options.harnessId)};
const mode = ${JSON.stringify(mode)};
const startedAt = Date.now();
const safeInput = input && typeof input === "object" ? input : {};
const summary = safeInput.summary && typeof safeInput.summary === "object" ? safeInput.summary : {};
const headers = safeInput.headers && typeof safeInput.headers === "object" ? safeInput.headers : {};
const headerSignals = [];
for (const [name, rawValue] of Object.entries(headers)) {
  const key = name.toLowerCase();
  if (key !== "user-agent" && key !== "x-user-agent" && key !== "x-client-user-agent" && key !== "x-ccr-client" && key !== "x-client-name") continue;
  if (Array.isArray(rawValue)) headerSignals.push(rawValue.join(" "));
  else if (typeof rawValue === "string") headerSignals.push(rawValue);
}
const agentSignal = headerSignals.join(" ").toLowerCase();
const detectedHarness = /openai-codex|codex[_ -]?cli/.test(agentSignal)
  ? "codex"
  : /@anthropic-ai\\/claude-code|claude[-_ ]code|claude[_ -]?cli/.test(agentSignal)
    ? "claude"
    : null;
if (detectedHarness !== harnessId) return null;
const prompt = typeof summary.lastUserText === "string" ? summary.lastUserText : "";
const toolCount = Array.isArray(summary.toolNames) ? summary.toolNames.length : 0;
const tokenCount = Number.isSafeInteger(safeInput.tokenCount) && safeInput.tokenCount > 0 ? safeInput.tokenCount : null;
const decision = classifySmartRoutingPrompt({
  text: prompt,
  hasImage: summary.hasImage === true,
  toolCount,
  inputTokens: tokenCount
});
const rawSimpleModel = api.env("TOKEN_HARNESS_ROUTING_SIMPLE_MODEL");
const simpleModel = typeof rawSimpleModel === "string" && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(rawSimpleModel)
  ? rawSimpleModel
  : ${JSON.stringify(configuredSimpleModel)};
const requestModel = typeof safeInput.model === "string" && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(safeInput.model)
  ? safeInput.model
  : null;
const rawSessionId = typeof safeInput.sessionId === "string" ? safeInput.sessionId : null;
const sessionId = rawSessionId !== null && /^[A-Za-z0-9_.:-]{1,256}$/.test(rawSessionId) ? rawSessionId : null;
const candidateModel = decision.tier === "simple" ? simpleModel : null;
let routeMutationRequested = false;
let routeSkipReason = null;
if (mode === "shadow") {
  routeSkipReason = "shadow-mode";
} else if (mode !== "conservative") {
  routeSkipReason = "unsupported-mode";
} else if (decision.tier !== "simple") {
  routeSkipReason = "complexity-not-simple";
} else if (candidateModel === null) {
  routeSkipReason = "simple-model-not-configured";
} else if (requestModel === null) {
  routeSkipReason = "request-model-unavailable";
} else if (!decision.conservativeEligible) {
  routeSkipReason = "conservative-safety-gate";
} else if (toolCount > 0 && api.env("TOKEN_HARNESS_ROUTING_ALLOW_TOOLS") !== "true") {
  routeSkipReason = "tool-compatibility-unconfirmed";
} else if (candidateModel === requestModel) {
  routeSkipReason = "model-already-selected";
} else {
  routeMutationRequested = true;
}
const now = new Date();
const epoch = now.getTime();
const suffix = Math.random().toString(36).slice(2, 10);
const eventId = String(epoch) + "-" + suffix;
const event = {
  schemaVersion: ${eventSchemaVersion},
  eventId,
  timestamp: now.toISOString(),
  source: "ccr",
  harnessId,
  mode,
  classifierVersion: ${JSON.stringify(classifierVersion)},
  tier: decision.tier,
  score: decision.score,
  confidence: decision.confidence,
  reasonCodes: decision.reasonCodes,
  requestModel,
  candidateModel,
  routeMutationRequested,
  routeSkipReason,
  promptChars: decision.promptChars,
  requestInputTokenEstimate: tokenCount,
  toolCount,
  hasImage: decision.hasImage,
  decisionLatencyMs: Math.max(0, Date.now() - startedAt),
  sessionId,
  measurement: {
    status: "not-measured",
    resolvedModel: null,
    providerInputTokens: null,
    providerOutputTokens: null,
    qualityGate: "unknown"
  }
};
try {
  await api.fs.writeJson(telemetryPathPrefix + "smart-routing-" + String(epoch).padStart(13, "0") + "-" + suffix + ".json", event);
} catch {
  // A telemetry write failure must never break the user's CCR request path.
}
if (routeMutationRequested) return { model: candidateModel };
return null;`;
}

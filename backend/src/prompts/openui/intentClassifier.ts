import { INTENT_ANCHOR_EXAMPLES, type PromptIntentKey } from './intentEmbeddings.js';
import type { PromptIntentVector } from './promptIntents.js';

export type IntentClassifierClarity = 'ambiguous' | 'clear';

export interface IntentClassifierResult {
  clarity: IntentClassifierClarity;
  confidence: Partial<Record<PromptIntentKey, number>>;
  intents: PromptIntentKey[];
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const HIGH_CONFIDENCE_THRESHOLD = 0.42;
const LOW_CONFIDENCE_THRESHOLD = 0.24;

function tokenize(value: string) {
  return [...value.toLowerCase().matchAll(TOKEN_PATTERN)].map((match) => match[0] ?? '');
}

function jaccardSimilarity(leftTokens: string[], rightTokens: string[]) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;

  return union > 0 ? intersection / union : 0;
}

function createEmptyConfidence(): Partial<Record<PromptIntentKey, number>> {
  return {};
}

export function classifyOpenUiPromptIntentWithAnchors(prompt: string): IntentClassifierResult {
  const promptTokens = tokenize(prompt);
  const confidence = createEmptyConfidence();

  for (const anchor of INTENT_ANCHOR_EXAMPLES) {
    const similarity = jaccardSimilarity(promptTokens, tokenize(anchor.text)) * (anchor.weight ?? 1);
    const currentConfidence = confidence[anchor.intent] ?? 0;

    confidence[anchor.intent] = Math.max(currentConfidence, Math.min(1, similarity));
  }

  const sortedIntents = (Object.entries(confidence) as Array<[PromptIntentKey, number]>)
    .filter(([, score]) => score >= LOW_CONFIDENCE_THRESHOLD)
    .sort((left, right) => right[1] - left[1]);
  const highConfidenceIntents = sortedIntents
    .filter(([, score]) => score >= HIGH_CONFIDENCE_THRESHOLD)
    .map(([intent]) => intent);
  const intents = highConfidenceIntents.length > 0 ? highConfidenceIntents : sortedIntents.slice(0, 2).map(([intent]) => intent);
  const topScore = sortedIntents[0]?.[1] ?? 0;
  const secondScore = sortedIntents[1]?.[1] ?? 0;

  return {
    clarity: topScore >= HIGH_CONFIDENCE_THRESHOLD && topScore - secondScore >= 0.12 ? 'clear' : 'ambiguous',
    confidence,
    intents,
  };
}

export function mergeAnchorIntentFallback(intents: PromptIntentVector, prompt: string): PromptIntentVector {
  const activeIntentCount = Object.values(intents).filter(Boolean).length;

  if (activeIntentCount >= 2) {
    return intents;
  }

  const classification = classifyOpenUiPromptIntentWithAnchors(prompt);
  const mergedIntents = { ...intents };

  for (const intent of classification.intents) {
    const confidence = classification.confidence[intent] ?? 0;

    if (confidence >= HIGH_CONFIDENCE_THRESHOLD || (activeIntentCount === 0 && confidence >= LOW_CONFIDENCE_THRESHOLD)) {
      mergedIntents[intent] = true;
    }
  }

  if (mergedIntents.random) {
    mergedIntents.compute = true;
  }

  return mergedIntents;
}

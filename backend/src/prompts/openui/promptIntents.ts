import {
  promptRequestsCompute,
  promptRequestsFiltering,
  promptRequestsMultiScreen,
  promptRequestsRandom,
  promptRequestsTheme,
  promptRequestsThemeState,
  promptRequestsTodo,
  promptRequestsValidation,
  promptRequestsVisualStyling,
} from './qualitySignals.js';

export interface PromptIntentVector {
  compute: boolean;
  filtering: boolean;
  multiScreen: boolean;
  random: boolean;
  theme: boolean;
  todo: boolean;
  validation: boolean;
}

const PROMPT_INTENT_CODES: Array<[keyof PromptIntentVector, string]> = [
  ['todo', 't'],
  ['theme', 'th'],
  ['filtering', 'f'],
  ['validation', 'v'],
  ['compute', 'c'],
  ['random', 'r'],
  ['multiScreen', 'ms'],
];

export function detectPromptIntents(prompt: string): PromptIntentVector {
  const trimmedPrompt = prompt.trim();
  const random = promptRequestsRandom(trimmedPrompt);

  return {
    compute: promptRequestsCompute(trimmedPrompt) || random,
    filtering: promptRequestsFiltering(trimmedPrompt),
    multiScreen: promptRequestsMultiScreen(trimmedPrompt),
    random,
    theme:
      promptRequestsTheme(trimmedPrompt) ||
      promptRequestsThemeState(trimmedPrompt) ||
      promptRequestsVisualStyling(trimmedPrompt),
    todo: promptRequestsTodo(trimmedPrompt),
    validation: promptRequestsValidation(trimmedPrompt),
  };
}

export function formatPromptIntentVector(intents: PromptIntentVector) {
  const activeCodes = PROMPT_INTENT_CODES.flatMap(([intentKey, code]) => (intents[intentKey] ? [code] : []));

  return activeCodes.length > 0 ? activeCodes.join('+') : 'base';
}

export function getPromptIntentCacheVector(prompt?: string) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return 'base';
  }

  return formatPromptIntentVector(detectPromptIntents(prompt));
}

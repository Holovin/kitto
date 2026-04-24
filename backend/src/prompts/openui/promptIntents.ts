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
  isSimplePromptRequest,
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

export type PromptRequestOperation = 'create' | 'modify' | 'repair' | 'unknown';
export type PromptRequestMinimality = 'simple' | 'normal';

export interface PromptRequestIntent extends PromptIntentVector {
  minimality: PromptRequestMinimality;
  operation: PromptRequestOperation;
}

interface DetectPromptRequestIntentOptions {
  currentSource?: string;
  mode?: 'initial' | 'repair';
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

const COMPLEX_MINIMALITY_INTENT_KEYS: Array<keyof PromptIntentVector> = [
  'compute',
  'filtering',
  'multiScreen',
  'random',
  'theme',
  'validation',
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

function detectPromptRequestOperation(prompt: string, options: DetectPromptRequestIntentOptions): PromptRequestOperation {
  if (options.mode === 'repair') {
    return 'repair';
  }

  if (!prompt.trim()) {
    return 'unknown';
  }

  return options.currentSource?.trim() ? 'modify' : 'create';
}

function detectPromptRequestMinimality(prompt: string, intents: PromptIntentVector): PromptRequestMinimality {
  if (!isSimplePromptRequest(prompt)) {
    return 'normal';
  }

  return COMPLEX_MINIMALITY_INTENT_KEYS.some((intentKey) => intents[intentKey]) ? 'normal' : 'simple';
}

export function detectPromptRequestIntent(prompt: string, options: DetectPromptRequestIntentOptions = {}): PromptRequestIntent {
  const intents = detectPromptIntents(prompt);

  return {
    ...intents,
    operation: detectPromptRequestOperation(prompt, options),
    minimality: detectPromptRequestMinimality(prompt, intents),
  };
}

export function formatPromptRequestIntentBlock(intent: PromptRequestIntent) {
  return [
    `todo: ${intent.todo}`,
    `filtering: ${intent.filtering}`,
    `validation: ${intent.validation}`,
    `compute: ${intent.compute}`,
    `random: ${intent.random}`,
    `theme: ${intent.theme}`,
    `multiScreen: ${intent.multiScreen}`,
    `operation: ${intent.operation}`,
    `minimality: ${intent.minimality}`,
  ].join('\n');
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

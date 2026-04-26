import { detectPromptIntents, type PromptIntentVector } from './promptIntents.js';
import { BUTTON_APPEARANCE_RULE, buildIntentSpecificRules } from './ruleRegistry.js';

export { BUTTON_APPEARANCE_RULE };

const BASE_PROMPT_INTENTS: PromptIntentVector = {
  compute: false,
  filtering: false,
  multiScreen: false,
  random: false,
  theme: false,
  todo: false,
  validation: false,
};

export function buildIntentSpecificRulesForPrompt(prompt: string | undefined) {
  const intents = typeof prompt === 'string' && prompt.trim().length > 0 ? detectPromptIntents(prompt) : BASE_PROMPT_INTENTS;

  return buildIntentSpecificRules(intents);
}

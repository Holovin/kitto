import type { AppEnv } from '#backend/env.js';
import { getEffectiveSourceMaxChars } from '#backend/limits.js';
import {
  APP_MEMORY_MAX_CHARS,
  CURRENT_SOURCE_ITEMS_MAX_CHARS,
  HISTORY_SUMMARY_MAX_CHARS,
  PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  PREVIOUS_CONTEXT_INPUT_MAX_TOTAL_CHARS,
  PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
  SELECTED_EXAMPLES_MAX_CHARS,
  VALIDATION_ISSUES_MAX_CHARS,
  type BudgetDecisionSection,
} from '@kitto-openui/shared/builderApiContract.js';

function createPromptContextLimitSection(
  name: string,
  protectedSection: boolean,
  options: {
    hardLimitChars?: number;
    softLimitChars?: number;
  } = {},
): BudgetDecisionSection {
  return {
    name,
    chars: 0,
    included: false,
    protected: protectedSection,
    ...(options.hardLimitChars !== undefined ? { hardLimitChars: options.hardLimitChars } : {}),
    ...(options.softLimitChars !== undefined ? { softLimitChars: options.softLimitChars } : {}),
  };
}

export function buildPromptContextLimitSections(env: AppEnv): BudgetDecisionSection[] {
  return [
    createPromptContextLimitSection('latestUserPrompt', true, {
      hardLimitChars: env.userPromptMaxChars,
    }),
    createPromptContextLimitSection('validationIssues', true, {
      hardLimitChars: VALIDATION_ISSUES_MAX_CHARS,
    }),
    createPromptContextLimitSection('currentSource', true, {
      hardLimitChars: getEffectiveSourceMaxChars(env),
    }),
    createPromptContextLimitSection('appMemory', false, {
      hardLimitChars: APP_MEMORY_MAX_CHARS,
    }),
    createPromptContextLimitSection('historySummary', false, {
      hardLimitChars: HISTORY_SUMMARY_MAX_CHARS,
      softLimitChars: HISTORY_SUMMARY_MAX_CHARS,
    }),
    createPromptContextLimitSection('previousUserMessages', false, {
      hardLimitChars: PREVIOUS_CONTEXT_INPUT_MAX_TOTAL_CHARS,
      softLimitChars: PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
    }),
    createPromptContextLimitSection('previousChangeSummaries', false, {
      hardLimitChars: PREVIOUS_CONTEXT_INPUT_MAX_TOTAL_CHARS,
      softLimitChars: PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
    }),
    createPromptContextLimitSection('selectedExamples', false, {
      softLimitChars: SELECTED_EXAMPLES_MAX_CHARS,
    }),
    createPromptContextLimitSection('examples', false, {
      softLimitChars: SELECTED_EXAMPLES_MAX_CHARS,
    }),
    createPromptContextLimitSection('currentSourceItems', false, {
      softLimitChars: CURRENT_SOURCE_ITEMS_MAX_CHARS,
    }),
  ];
}

export function getPromptContextLimitSection(sections: BudgetDecisionSection[], name: string) {
  return sections.find((section) => section.name === name);
}

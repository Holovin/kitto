import {
  createEmptyAppMemory,
  PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS,
  PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  PREVIOUS_USER_MESSAGES_MAX_ITEMS,
  PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
} from '@kitto-openui/shared/builderApiContract.js';
import type { AppMemory, BuilderChatMessage, BudgetDecisionSection } from '@pages/Chat/builder/types';

function trimToTotalChars(values: string[], maxTotalChars: number) {
  const selected: string[] = [];
  let remainingChars = maxTotalChars;

  for (let index = values.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const value = values[index]?.trim();

    if (!value) {
      continue;
    }

    const nextValue = value.length > remainingChars ? value.slice(0, remainingChars).trimEnd() : value;

    if (!nextValue) {
      continue;
    }

    selected.unshift(nextValue);
    remainingChars -= nextValue.length;
  }

  return selected;
}

export function buildPreviousUserMessages(messages: BuilderChatMessage[]) {
  const previousUserMessages = messages.flatMap((message) => {
    if (message.role !== 'user' || message.excludeFromLlmContext) {
      return [];
    }

    const content = message.content.trim();
    return content ? [content] : [];
  });

  return trimToTotalChars(previousUserMessages.slice(-PREVIOUS_USER_MESSAGES_MAX_ITEMS), PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS);
}

export function buildPreviousChangeSummaries(changeSummaries: string[]) {
  const previousChangeSummaries = changeSummaries.flatMap((summary) => {
    const content = summary.trim();
    return content ? [content] : [];
  });

  return trimToTotalChars(
    previousChangeSummaries.slice(-PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS),
    PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  );
}

function getJsonChars(value: unknown) {
  return JSON.stringify(value ?? null).length;
}

function createMeterSection(
  name: string,
  chars: number,
  included: boolean,
  protectedSection: boolean,
  reason?: string,
): BudgetDecisionSection {
  return {
    name,
    chars,
    included,
    protected: protectedSection,
    ...(reason ? { reason } : {}),
  };
}

export function buildContextMeterSections({
  appMemory,
  currentSource,
  latestUserPrompt,
  previousChangeSummaries,
  previousUserMessages,
}: {
  appMemory?: AppMemory;
  currentSource: string;
  latestUserPrompt: string;
  previousChangeSummaries: string[];
  previousUserMessages: string[];
}) {
  const hasCurrentSource = currentSource.trim().length > 0;

  return [
    createMeterSection('system/contract', 0, true, true, 'hidden static prefix'),
    createMeterSection('latestUserPrompt', latestUserPrompt.trim().length, latestUserPrompt.trim().length > 0, true),
    createMeterSection(
      'currentSource',
      currentSource.length,
      hasCurrentSource,
      true,
      hasCurrentSource ? 'protected' : 'blank canvas',
    ),
    createMeterSection('appMemory', getJsonChars(appMemory ?? createEmptyAppMemory()), true, false),
    createMeterSection('historySummary', 0, false, false, 'omitted'),
    createMeterSection('previousUserMessages', getJsonChars(previousUserMessages), previousUserMessages.length > 0, false),
    createMeterSection(
      'previousChangeSummaries',
      getJsonChars(previousChangeSummaries),
      previousChangeSummaries.length > 0,
      false,
    ),
    createMeterSection('examples', 0, false, false, 'backend optional'),
    createMeterSection('currentSourceItems', 0, false, false, 'omitted'),
  ];
}

export function formatContextMeterTooltip(sections: BudgetDecisionSection[]) {
  const formatNumber = new Intl.NumberFormat();
  const lines = ['Context:'];

  for (const section of sections) {
    const charLabel = `${formatNumber.format(section.chars)} chars${section.protected ? ' protected' : ''}`;
    const status = section.included ? (section.chars === 0 && section.reason ? section.reason : charLabel) : section.reason ?? 'omitted';

    lines.push(`- ${section.name}: ${status}`);
  }

  return lines.join('\n');
}

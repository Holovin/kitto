import {
  PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS,
  PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  PREVIOUS_USER_MESSAGES_MAX_ITEMS,
  PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
} from '@kitto-openui/shared/builderApiContract.js';
import type { BuilderChatMessage } from '@pages/Chat/builder/types';

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

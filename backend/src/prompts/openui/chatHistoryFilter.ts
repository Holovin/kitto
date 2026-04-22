import type { PromptBuildChatHistoryMessage, RawPromptBuildChatHistoryMessage } from './types.js';

const LEGACY_EXCLUDED_ASSISTANT_MESSAGE_PATTERNS = [
  /^Applied the latest chat instruction\b/,
  /^Building:/,
  /^Updated the app definition\b/,
  /^(?:Updated|Changed|Modified) the (?:current )?(?:app|app definition|ui|interface)\.?$/i,
  /^(?:Made|Applied|Implemented|Completed) the requested (?:changes|update)\.?$/i,
  /^The model returned\b/,
  /^The first draft\b/,
  /^Definition exported\b/,
  /^Import failed\b/,
] as const;

function isPromptConversationChatMessage(
  message: RawPromptBuildChatHistoryMessage,
): message is RawPromptBuildChatHistoryMessage & { role: PromptBuildChatHistoryMessage['role'] } {
  return message.role === 'assistant' || message.role === 'user';
}

function normalizeMaxItems(maxItems?: number) {
  if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(maxItems));
}

function getFirstUserMessageIndex(messages: PromptBuildChatHistoryMessage[]) {
  return messages.findIndex((message) => message.role === 'user');
}

export function retainPromptBuildChatHistoryTail(
  messages: PromptBuildChatHistoryMessage[],
  latestTailCount: number,
): PromptBuildChatHistoryMessage[] {
  if (messages.length === 0) {
    return [];
  }

  const normalizedTailCount = Math.max(0, Math.min(messages.length, Math.floor(latestTailCount)));
  const firstUserMessageIndex = getFirstUserMessageIndex(messages);
  const firstUserMessage = firstUserMessageIndex >= 0 ? messages[firstUserMessageIndex] : null;

  if (normalizedTailCount === 0) {
    return firstUserMessage ? [firstUserMessage] : [];
  }

  const tailMessages = messages.slice(-normalizedTailCount);

  if (!firstUserMessage) {
    return tailMessages;
  }

  const tailStartIndex = messages.length - tailMessages.length;

  if (firstUserMessageIndex >= tailStartIndex) {
    return tailMessages;
  }

  return [firstUserMessage, ...tailMessages];
}

export function retainPromptBuildChatHistory(
  messages: PromptBuildChatHistoryMessage[],
  maxItems?: number,
): PromptBuildChatHistoryMessage[] {
  const normalizedMaxItems = normalizeMaxItems(maxItems);

  if (normalizedMaxItems <= 0) {
    return [];
  }

  if (!Number.isFinite(normalizedMaxItems) || messages.length <= normalizedMaxItems) {
    return messages;
  }

  const firstUserMessageIndex = getFirstUserMessageIndex(messages);
  const firstUserMessage = firstUserMessageIndex >= 0 ? messages[firstUserMessageIndex] : null;

  if (!firstUserMessage) {
    return messages.slice(-normalizedMaxItems);
  }

  const newestWindowStartIndex = messages.length - normalizedMaxItems;

  if (firstUserMessageIndex >= newestWindowStartIndex) {
    return messages.slice(-normalizedMaxItems);
  }

  if (normalizedMaxItems === 1) {
    return [firstUserMessage];
  }

  return [firstUserMessage, ...messages.slice(-(normalizedMaxItems - 1))];
}

export function isLegacyExcludedAssistantMessage(message: Pick<RawPromptBuildChatHistoryMessage, 'content' | 'role'>) {
  if (message.role !== 'assistant') {
    return false;
  }

  const normalizedContent = message.content.trim();

  return LEGACY_EXCLUDED_ASSISTANT_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalizedContent));
}

export function filterPromptBuildChatHistory(
  messages: RawPromptBuildChatHistoryMessage[],
  maxItems?: number,
): PromptBuildChatHistoryMessage[] {
  const normalizedMaxItems = normalizeMaxItems(maxItems);

  if (normalizedMaxItems <= 0) {
    return [];
  }

  const filteredMessages = messages
    .filter(isPromptConversationChatMessage)
    .filter((message) => message.content.trim().length > 0)
    .filter((message) => message.excludeFromLlmContext !== true)
    .filter((message) => !isLegacyExcludedAssistantMessage(message))
    .map(({ content, role }) => ({ content, role }));

  if (!Number.isFinite(normalizedMaxItems)) {
    return filteredMessages;
  }

  return filteredMessages.slice(-normalizedMaxItems);
}

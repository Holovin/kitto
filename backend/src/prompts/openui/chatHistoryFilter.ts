import type { PromptBuildChatHistoryMessage, RawPromptBuildChatHistoryMessage } from './types.js';

const LEGACY_EXCLUDED_ASSISTANT_MESSAGE_PATTERNS = [
  /^Applied the latest chat instruction\b/,
  /^Building:/,
  /^Updated the app definition\b/,
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

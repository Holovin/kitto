import type { BuilderChatMessage, BuilderLlmRequest } from '@features/builder/types';

type BuilderRequestChatMessage = BuilderLlmRequest['chatHistory'][number];

const LEGACY_EXCLUDED_ASSISTANT_MESSAGE_PATTERNS = [
  /^Updated the app definition\b/,
  /^The model returned\b/,
  /^The first draft\b/,
  /^Definition exported\b/,
  /^Import failed\b/,
] as const;

function isRequestChatMessage(
  message: BuilderChatMessage,
): message is BuilderChatMessage & { role: BuilderRequestChatMessage['role'] } {
  return message.role === 'assistant' || message.role === 'user';
}

function isLegacyExcludedAssistantMessage(message: BuilderChatMessage) {
  if (message.role !== 'assistant') {
    return false;
  }

  const normalizedContent = message.content.trim();

  return LEGACY_EXCLUDED_ASSISTANT_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalizedContent));
}

export function buildRequestChatHistory(messages: BuilderChatMessage[], maxItems: number): BuilderRequestChatMessage[] {
  const normalizedMaxItems = Number.isFinite(maxItems) ? Math.max(0, Math.floor(maxItems)) : 0;

  if (normalizedMaxItems <= 0) {
    return [];
  }

  return messages
    .filter(isRequestChatMessage)
    .filter((message) => message.content.trim().length > 0)
    .filter((message) => message.excludeFromLlmContext !== true)
    .filter((message) => !isLegacyExcludedAssistantMessage(message))
    .slice(-normalizedMaxItems)
    .map(({ content, role }) => ({ content, role }));
}

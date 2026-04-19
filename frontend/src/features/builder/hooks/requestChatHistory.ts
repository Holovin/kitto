import type { BuilderChatMessage, BuilderLlmRequest } from '@features/builder/types';

type BuilderRequestChatMessage = BuilderLlmRequest['chatHistory'][number];

function isRequestChatMessage(
  message: BuilderChatMessage,
): message is BuilderChatMessage & { role: BuilderRequestChatMessage['role'] } {
  return message.role === 'assistant' || message.role === 'user';
}

export function buildRequestChatHistory(messages: BuilderChatMessage[], maxItems: number): BuilderRequestChatMessage[] {
  return messages.filter(isRequestChatMessage).slice(-maxItems).map(({ content, role }) => ({ content, role }));
}

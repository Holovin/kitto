import type { BuilderLlmRequest } from '@features/builder/types';

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function formatLimitValue(value: number) {
  return new Intl.NumberFormat().format(value);
}

export const builderRequestLimits = {
  promptMaxChars: parsePositiveInteger(import.meta.env.VITE_LLM_PROMPT_MAX_CHARS, 40_000),
  currentSourceMaxChars: parsePositiveInteger(import.meta.env.VITE_LLM_CURRENT_SOURCE_MAX_CHARS, 200_000),
  chatMessageMaxChars: parsePositiveInteger(import.meta.env.VITE_LLM_CHAT_MESSAGE_MAX_CHARS, 20_000),
  chatHistoryMaxItems: parsePositiveInteger(import.meta.env.VITE_LLM_CHAT_HISTORY_MAX_ITEMS, 40),
  requestMaxBytes: parsePositiveInteger(import.meta.env.VITE_LLM_REQUEST_MAX_BYTES, 1_500_000),
} as const;

const textEncoder = new TextEncoder();

export function validateBuilderLlmRequest(request: BuilderLlmRequest) {
  if (request.prompt.length > builderRequestLimits.promptMaxChars) {
    return `Prompt is too large. Limit: ${formatLimitValue(builderRequestLimits.promptMaxChars)} characters.`;
  }

  if (request.currentSource.length > builderRequestLimits.currentSourceMaxChars) {
    return `Current source is too large. Limit: ${formatLimitValue(builderRequestLimits.currentSourceMaxChars)} characters.`;
  }

  if (request.chatHistory.length > builderRequestLimits.chatHistoryMaxItems) {
    return `Chat history is too large. Limit: ${formatLimitValue(builderRequestLimits.chatHistoryMaxItems)} messages.`;
  }

  const oversizedMessage = request.chatHistory.find((message) => message.content.length > builderRequestLimits.chatMessageMaxChars);

  if (oversizedMessage) {
    return `One of the previous chat messages is too large. Limit: ${formatLimitValue(builderRequestLimits.chatMessageMaxChars)} characters per message.`;
  }

  const requestSizeBytes = textEncoder.encode(JSON.stringify(request)).byteLength;

  if (requestSizeBytes > builderRequestLimits.requestMaxBytes) {
    return `Request body is too large. Limit: ${formatLimitValue(builderRequestLimits.requestMaxBytes)} bytes.`;
  }

  return null;
}

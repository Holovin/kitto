import type { BuilderConfigResponse, BuilderLlmRequest } from '@features/builder/types';

function parsePositiveInteger(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function formatLimitValue(value: number) {
  return new Intl.NumberFormat().format(value);
}

export const DEFAULT_BUILDER_REQUEST_LIMITS = {
  promptMaxChars: 4_096,
  chatHistoryMaxItems: 40,
  requestMaxBytes: 300_000,
};

export interface BuilderRequestLimits {
  chatHistoryMaxItems: number;
  promptMaxChars: number;
  requestMaxBytes: number;
}

export function getBuilderRequestLimits(config?: BuilderConfigResponse): BuilderRequestLimits {
  return {
    promptMaxChars: parsePositiveInteger(config?.limits.promptMaxChars, DEFAULT_BUILDER_REQUEST_LIMITS.promptMaxChars),
    chatHistoryMaxItems: parsePositiveInteger(config?.limits.chatHistoryMaxItems, DEFAULT_BUILDER_REQUEST_LIMITS.chatHistoryMaxItems),
    requestMaxBytes: parsePositiveInteger(config?.limits.requestMaxBytes, DEFAULT_BUILDER_REQUEST_LIMITS.requestMaxBytes),
  };
}

export function validateBuilderLlmRequest(request: BuilderLlmRequest, limits: BuilderRequestLimits) {
  if (request.prompt.length > limits.promptMaxChars) {
    return `Prompt is too large. Limit: ${formatLimitValue(limits.promptMaxChars)} characters.`;
  }

  return null;
}

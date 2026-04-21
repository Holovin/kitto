import type { BuilderConfigResponse, BuilderLlmRequest } from '@features/builder/types';
import { serializeBuilderLlmRequest } from './api/requestBody';

const textEncoder = new TextEncoder();

function parsePositiveInteger(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function formatLimitValue(value: number) {
  return new Intl.NumberFormat().format(value);
}

const DEFAULT_BUILDER_REQUEST_LIMITS = {
  promptMaxChars: 4_096,
  chatHistoryMaxItems: 40,
  requestMaxBytes: 300_000,
};
const DEFAULT_BUILDER_STREAM_TIMEOUTS = {
  streamIdleTimeoutMs: 45_000,
  streamMaxDurationMs: 120_000,
};
const DEFAULT_BUILDER_MAX_REPAIR_ATTEMPTS = 1;

export interface BuilderRequestLimits {
  chatHistoryMaxItems: number;
  promptMaxChars: number;
  requestMaxBytes: number;
}

interface BuilderStreamTimeouts {
  streamIdleTimeoutMs: number;
  streamMaxDurationMs: number;
}

export function getBuilderMaxRepairAttempts(config?: BuilderConfigResponse) {
  return parsePositiveInteger(config?.repair.maxRepairAttempts, DEFAULT_BUILDER_MAX_REPAIR_ATTEMPTS);
}

export function getBuilderRequestLimits(config?: BuilderConfigResponse): BuilderRequestLimits {
  return {
    promptMaxChars: parsePositiveInteger(config?.limits.promptMaxChars, DEFAULT_BUILDER_REQUEST_LIMITS.promptMaxChars),
    chatHistoryMaxItems: parsePositiveInteger(config?.limits.chatHistoryMaxItems, DEFAULT_BUILDER_REQUEST_LIMITS.chatHistoryMaxItems),
    requestMaxBytes: parsePositiveInteger(config?.limits.requestMaxBytes, DEFAULT_BUILDER_REQUEST_LIMITS.requestMaxBytes),
  };
}

export function getBuilderStreamTimeouts(config?: BuilderConfigResponse): BuilderStreamTimeouts {
  return {
    streamIdleTimeoutMs: parsePositiveInteger(
      config?.timeouts.streamIdleTimeoutMs,
      DEFAULT_BUILDER_STREAM_TIMEOUTS.streamIdleTimeoutMs,
    ),
    streamMaxDurationMs: parsePositiveInteger(
      config?.timeouts.streamMaxDurationMs,
      DEFAULT_BUILDER_STREAM_TIMEOUTS.streamMaxDurationMs,
    ),
  };
}

export function getApproximateBuilderRequestSizeBytes(request: BuilderLlmRequest) {
  return textEncoder.encode(serializeBuilderLlmRequest(request)).byteLength;
}

export function validateBuilderLlmRequest(request: BuilderLlmRequest, limits: BuilderRequestLimits) {
  if (request.prompt.length > limits.promptMaxChars) {
    return `Prompt is too large. Limit: ${formatLimitValue(limits.promptMaxChars)} characters.`;
  }

  const approximateRequestSizeBytes = getApproximateBuilderRequestSizeBytes(request);

  if (approximateRequestSizeBytes > limits.requestMaxBytes) {
    return `The request is too large to send as-is. Limit: ${formatLimitValue(limits.requestMaxBytes)} bytes for the full request payload. Shorten the prompt or reduce recent context and try again.`;
  }

  return null;
}

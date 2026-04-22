import type { BuilderConfigResponse, BuilderLlmRequest } from '@features/builder/types';
import { serializeBuilderLlmRequest } from './api/requestBody';

const textEncoder = new TextEncoder();

export type BuilderRuntimeConfigStatus = 'loading' | 'loaded' | 'failed';

function parsePositiveInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function formatLimitValue(value: number) {
  return new Intl.NumberFormat().format(value);
}

export interface BuilderRequestLimits {
  chatHistoryMaxItems: number;
  promptMaxChars: number;
  requestMaxBytes: number;
}

export interface BuilderStreamTimeouts {
  streamIdleTimeoutMs: number;
  streamMaxDurationMs: number;
}

export function getBuilderMaxRepairAttempts(config?: BuilderConfigResponse) {
  return parsePositiveInteger(config?.repair.maxRepairAttempts);
}

export function getBuilderMaxRepairValidationIssues(config?: BuilderConfigResponse) {
  return parsePositiveInteger(config?.repair.maxValidationIssues);
}

export function getBuilderRequestLimits(config?: BuilderConfigResponse): BuilderRequestLimits | null {
  const promptMaxChars = parsePositiveInteger(config?.limits.promptMaxChars);
  const chatHistoryMaxItems = parsePositiveInteger(config?.limits.chatHistoryMaxItems);
  const requestMaxBytes = parsePositiveInteger(config?.limits.requestMaxBytes);

  if (promptMaxChars === null || chatHistoryMaxItems === null || requestMaxBytes === null) {
    return null;
  }

  return {
    promptMaxChars,
    chatHistoryMaxItems,
    requestMaxBytes,
  };
}

export function getBuilderStreamTimeouts(config?: BuilderConfigResponse): BuilderStreamTimeouts | null {
  const streamIdleTimeoutMs = parsePositiveInteger(config?.timeouts.streamIdleTimeoutMs);
  const streamMaxDurationMs = parsePositiveInteger(config?.timeouts.streamMaxDurationMs);

  if (streamIdleTimeoutMs === null || streamMaxDurationMs === null) {
    return null;
  }

  return {
    streamIdleTimeoutMs,
    streamMaxDurationMs,
  };
}

export function getBuilderRuntimeConfigStatus(queryState: {
  data?: BuilderConfigResponse;
  isError?: boolean;
}): BuilderRuntimeConfigStatus {
  const hasResolvedLimits = getBuilderRequestLimits(queryState.data) !== null;
  const hasResolvedTimeouts = getBuilderStreamTimeouts(queryState.data) !== null;
  const hasResolvedRepairPolicy = getBuilderMaxRepairAttempts(queryState.data) !== null;
  const hasResolvedRepairValidationLimit = getBuilderMaxRepairValidationIssues(queryState.data) !== null;

  if (hasResolvedLimits && hasResolvedTimeouts && hasResolvedRepairPolicy && hasResolvedRepairValidationLimit) {
    return 'loaded';
  }

  if (queryState.isError || queryState.data) {
    return 'failed';
  }

  return 'loading';
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

import type { BuilderConfigResponse, PromptBuildRequest } from '@pages/Chat/builder/types';
import { CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE } from '@kitto-openui/shared/builderApiContract.js';
import { serializeBuilderLlmRequest } from '@pages/Chat/builder/api/requestBody';

const textEncoder = new TextEncoder();

export type BuilderRuntimeConfigStatus = 'loading' | 'loaded' | 'failed';

function parsePositiveInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function parseFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatLimitValue(value: number) {
  return new Intl.NumberFormat().format(value);
}

export interface BuilderRequestLimits {
  chatMessageMaxChars: number;
  chatHistoryMaxItems: number;
  promptMaxChars: number;
  requestMaxBytes: number;
  sourceMaxChars: number;
}

export interface BuilderStreamTimeouts {
  streamIdleTimeoutMs: number;
  streamMaxDurationMs: number;
}

export interface BuilderGenerationConfig {
  repairTemperature: number;
  temperature: number;
}

export function getBuilderSanitizedLlmRequestForTransport(request: PromptBuildRequest): PromptBuildRequest {
  return request;
}

export function getBuilderMaxRepairAttempts(config?: BuilderConfigResponse) {
  return parsePositiveInteger(config?.repair.maxRepairAttempts);
}

export function getBuilderMaxRepairValidationIssues(config?: BuilderConfigResponse) {
  return parsePositiveInteger(config?.repair.maxValidationIssues);
}

export function getBuilderRequestLimits(config?: BuilderConfigResponse): BuilderRequestLimits | null {
  const chatMessageMaxChars = parsePositiveInteger(config?.limits.chatMessageMaxChars);
  const promptMaxChars = parsePositiveInteger(config?.limits.promptMaxChars);
  const chatHistoryMaxItems = parsePositiveInteger(config?.limits.chatHistoryMaxItems);
  const requestMaxBytes = parsePositiveInteger(config?.limits.requestMaxBytes);
  const sourceMaxChars = parsePositiveInteger(config?.limits.sourceMaxChars);

  if (
    chatMessageMaxChars === null ||
    promptMaxChars === null ||
    chatHistoryMaxItems === null ||
    requestMaxBytes === null ||
    sourceMaxChars === null
  ) {
    return null;
  }

  return {
    chatMessageMaxChars,
    promptMaxChars,
    chatHistoryMaxItems,
    requestMaxBytes,
    sourceMaxChars,
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

export function getBuilderGenerationConfig(config?: BuilderConfigResponse): BuilderGenerationConfig | null {
  const temperature = parseFiniteNumber(config?.generation?.temperature);
  const repairTemperature = parseFiniteNumber(config?.generation?.repairTemperature);

  if (temperature === null || repairTemperature === null) {
    return null;
  }

  return {
    repairTemperature,
    temperature,
  };
}

export function getBuilderRuntimeConfigStatus(queryState: {
  data?: BuilderConfigResponse;
  isError?: boolean;
}): BuilderRuntimeConfigStatus {
  const hasResolvedGenerationConfig = getBuilderGenerationConfig(queryState.data) !== null;
  const hasResolvedLimits = getBuilderRequestLimits(queryState.data) !== null;
  const hasResolvedTimeouts = getBuilderStreamTimeouts(queryState.data) !== null;
  const hasResolvedRepairPolicy = getBuilderMaxRepairAttempts(queryState.data) !== null;
  const hasResolvedRepairValidationLimit = getBuilderMaxRepairValidationIssues(queryState.data) !== null;

  if (
    hasResolvedGenerationConfig &&
    hasResolvedLimits &&
    hasResolvedTimeouts &&
    hasResolvedRepairPolicy &&
    hasResolvedRepairValidationLimit
  ) {
    return 'loaded';
  }

  if (queryState.isError || queryState.data) {
    return 'failed';
  }

  return 'loading';
}

export function getApproximateBuilderRequestSizeBytes(request: PromptBuildRequest) {
  return textEncoder.encode(serializeBuilderLlmRequest(request)).byteLength;
}

export function validateBuilderLlmRequest(request: PromptBuildRequest, limits: BuilderRequestLimits) {
  if (request.prompt.length > limits.promptMaxChars) {
    return `Prompt is too large. Limit: ${formatLimitValue(limits.promptMaxChars)} characters.`;
  }

  if (request.currentSource.length > limits.sourceMaxChars) {
    return CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE;
  }

  if ((request.invalidDraft?.length ?? 0) > limits.sourceMaxChars) {
    return `Invalid draft is too large. Limit: ${formatLimitValue(limits.sourceMaxChars)} characters.`;
  }

  const sanitizedRequest = getBuilderSanitizedLlmRequestForTransport(request);
  const approximateRequestSizeBytes = getApproximateBuilderRequestSizeBytes(sanitizedRequest);

  if (approximateRequestSizeBytes > limits.requestMaxBytes) {
    return `The request is too large to send as-is. Limit: ${formatLimitValue(limits.requestMaxBytes)} bytes for the full request payload. Shorten the prompt or reduce recent context and try again.`;
  }

  return null;
}

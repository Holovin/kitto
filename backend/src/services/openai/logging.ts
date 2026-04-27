import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '#backend/env.js';
import { toPublicErrorPayload } from '#backend/errors/publicError.js';
import { buildOpenUiRawUserRequest, getPromptBuildValidationIssueCodes, type PromptBuildRequest } from '#backend/prompts/openui.js';
import { promptLog, type PromptIoCommitSource, type PromptIoLogMode, type PromptIoRepairOutcome } from '#backend/services/promptLog.js';
import type { OpenUiResponseRequest } from './client.js';
import { getSystemPromptHash } from './client.js';
import type { OpenUiGenerationEnvelope } from './envelope.js';

type ResponseInputItem = ResponseInput[number];

function isResponseInputMessage(
  item: ResponseInputItem,
): item is ResponseInputItem & { content: Array<{ text?: string; type?: string }>; role: string } {
  return (
    !!item &&
    typeof item === 'object' &&
    'role' in item &&
    'content' in item &&
    Array.isArray((item as { content?: unknown }).content)
  );
}

function buildPromptLogModelInput(responseRequest: OpenUiResponseRequest) {
  const sanitizedInput = Array.isArray(responseRequest.input)
    ? responseRequest.input.map((message) => {
        if (!isResponseInputMessage(message) || message.role !== 'system') {
          return message;
        }

        return {
          ...message,
          content: message.content.map((part: { text?: string; type?: string }) => {
            if (part.type !== 'input_text') {
              return part;
            }

            return {
              ...part,
              text: '[omitted; see systemPromptHash]',
            };
          }),
        };
      })
    : responseRequest.input;

  return {
    ...responseRequest,
    input: sanitizedInput,
  };
}

function getPromptLogRawUserRequest(request: PromptBuildRequest) {
  return buildOpenUiRawUserRequest(request);
}

function sanitizeValidationIssues(...issueGroups: Array<readonly unknown[] | undefined>) {
  const issues = issueGroups.flatMap((issueGroup) => issueGroup ?? []).filter(
    (issue): issue is string => typeof issue === 'string' && issue.trim().length > 0,
  );

  return issues.length > 0 ? [...new Set(issues)] : [];
}

function getPromptLogValidationIssues(request: PromptBuildRequest, validationIssues?: string[]) {
  return sanitizeValidationIssues(getPromptBuildValidationIssueCodes(request.validationIssues), validationIssues);
}

function getPromptLogMode(mode: unknown): PromptIoLogMode {
  return mode === 'initial' || mode === 'repair' ? mode : null;
}

function getPromptLogInputShape(mode: PromptIoLogMode) {
  if (mode === 'initial' || mode === 'repair') {
    return 'role-based' as const;
  }

  return undefined;
}

function getRepairAttempt(mode: PromptIoLogMode, repairAttemptNumber?: number) {
  if (mode !== 'repair') {
    return 0;
  }

  return repairAttemptNumber ?? 1;
}

function getPartialPromptBuildContext(partialBody: unknown) {
  if (!partialBody || typeof partialBody !== 'object') {
    return {
      chatHistoryLen: undefined,
      currentSourceLen: undefined,
      mode: null,
      parentRequestId: null,
      rawUserRequest: undefined,
      repairAttemptNumber: undefined,
      validationIssues: [] as string[],
    };
  }

  const partialRequest = partialBody as {
    chatHistory?: unknown;
    currentSource?: unknown;
    mode?: unknown;
    parentRequestId?: unknown;
    prompt?: unknown;
    repairAttemptNumber?: unknown;
    validationIssues?: unknown;
  };
  const mode = getPromptLogMode(partialRequest.mode);
  const partialValidationIssues = Array.isArray(partialRequest.validationIssues)
    ? partialRequest.validationIssues.flatMap((issue) => {
        if (typeof issue === 'string') {
          return issue;
        }

        if (issue && typeof issue === 'object' && 'code' in issue && typeof issue.code === 'string') {
          return issue.code;
        }

        return [];
      })
    : undefined;

  return {
    chatHistoryLen: Array.isArray(partialRequest.chatHistory) ? partialRequest.chatHistory.length : undefined,
    currentSourceLen: typeof partialRequest.currentSource === 'string' ? partialRequest.currentSource.length : undefined,
    mode,
    parentRequestId: typeof partialRequest.parentRequestId === 'string' ? partialRequest.parentRequestId : null,
    rawUserRequest:
      typeof partialRequest.prompt === 'string'
        ? buildOpenUiRawUserRequest({
            chatHistory: [],
            currentSource: '',
            mode: mode ?? 'initial',
            prompt: partialRequest.prompt,
          })
        : undefined,
    repairAttemptNumber:
      typeof partialRequest.repairAttemptNumber === 'number' ? partialRequest.repairAttemptNumber : undefined,
    validationIssues: sanitizeValidationIssues(partialValidationIssues),
  };
}

function coerceRawModelOutput(rawModelText: unknown) {
  if (typeof rawModelText === 'string') {
    return rawModelText;
  }

  if (rawModelText === null || rawModelText === undefined) {
    return '';
  }

  try {
    return JSON.stringify(rawModelText);
  } catch {
    return String(rawModelText);
  }
}

function getNumericField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getCachedInputTokens(usage: unknown) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const currentCachedTokens = getNumericField(
    (usage as { input_tokens_details?: { cached_tokens?: unknown } }).input_tokens_details?.cached_tokens,
  );

  if (currentCachedTokens !== null) {
    return currentCachedTokens;
  }

  return getNumericField((usage as { prompt_tokens_details?: { cached_tokens?: unknown } }).prompt_tokens_details?.cached_tokens);
}

function getPromptLogErrorCode(error: unknown) {
  return toPublicErrorPayload(error).code;
}

function getPromptLogErrorMessage(error: unknown) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

interface PromptIoRequestMetrics {
  compactedRequestBytes?: number | null;
  omittedChatMessages?: number | null;
  requestBytes?: number | null;
}

export function logResponseUsage(env: AppEnv, phase: 'create' | 'stream', response: unknown) {
  if (env.LOG_LEVEL !== 'debug' && env.LOG_LEVEL !== 'info') {
    return;
  }

  if (!response || typeof response !== 'object') {
    return;
  }

  const usage = (response as { usage?: unknown }).usage;

  if (!usage || typeof usage !== 'object') {
    return;
  }

  const inputTokens =
    getNumericField((usage as { input_tokens?: unknown }).input_tokens) ??
    getNumericField((usage as { prompt_tokens?: unknown }).prompt_tokens);
  const outputTokens =
    getNumericField((usage as { output_tokens?: unknown }).output_tokens) ??
    getNumericField((usage as { completion_tokens?: unknown }).completion_tokens);
  const totalTokens = getNumericField((usage as { total_tokens?: unknown }).total_tokens);
  const cachedTokens = getCachedInputTokens(usage);
  const requestId = typeof (response as { _request_id?: unknown })._request_id === 'string' ? (response as { _request_id?: string })._request_id : null;

  console.log(
    `[openai.responses.${phase}] request_id=${requestId ?? 'unknown'} input_tokens=${inputTokens ?? 'unknown'} cached_tokens=${cachedTokens ?? 'unknown'} output_tokens=${outputTokens ?? 'unknown'} total_tokens=${totalTokens ?? 'unknown'}`,
  );
}

export async function writePromptIoLogSafely(
  env: AppEnv,
  request: PromptBuildRequest,
  responseRequest: OpenUiResponseRequest,
  rawModelText: unknown,
  options: {
    compactedRequestBytes?: number | null;
    omittedChatMessages?: number | null;
    durationMs: number;
    parsedEnvelope: OpenUiGenerationEnvelope | null;
    requestId?: string | null;
    requestBytes?: number | null;
    usage: unknown;
    validationIssues?: string[];
  },
) {
  const mode = getPromptLogMode(request.mode);

  try {
    await promptLog.write(
      {
        ts: new Date().toISOString(),
        requestId: options.requestId ?? null,
        parentRequestId: request.parentRequestId ?? null,
        repairAttempt: getRepairAttempt(mode, request.repairAttemptNumber),
        mode,
        phase: null,
        rawUserRequest: getPromptLogRawUserRequest(request),
        currentSourceLen: request.currentSource.length,
        chatHistoryLen: request.chatHistory.length,
        requestBytes: options.requestBytes ?? null,
        compactedRequestBytes: options.compactedRequestBytes ?? null,
        omittedChatMessages: options.omittedChatMessages ?? null,
        inputShape: 'role-based',
        systemPromptHash: getSystemPromptHash(),
        modelInput: buildPromptLogModelInput(responseRequest),
        modelOutputRaw: coerceRawModelOutput(rawModelText),
        parsedEnvelope: options.parsedEnvelope,
        usage: options.usage,
        validationIssues: getPromptLogValidationIssues(request, options.validationIssues),
        durationMs: options.durationMs,
      },
      {
        enabled: env.PROMPT_IO_LOG,
      },
    );
  } catch (error) {
    console.warn('[prompt-log] Failed to write prompt I/O log entry.', error);
  }
}

export async function writePromptIoFailureSafely(
  env: AppEnv,
  request: PromptBuildRequest,
  responseRequest: OpenUiResponseRequest,
  rawModelText: unknown,
  options: {
    compactedRequestBytes?: number | null;
    omittedChatMessages?: number | null;
    durationMs: number;
    error: unknown;
    errorCode?: string;
    parsedEnvelope?: OpenUiGenerationEnvelope | null;
    phase: 'request' | 'stream' | 'parse';
    requestId?: string | null;
    requestBytes?: number | null;
    usage: unknown;
    validationIssues?: string[];
  },
) {
  const mode = getPromptLogMode(request.mode);

  try {
    await promptLog.writeFailure(
      {
        ts: new Date().toISOString(),
        requestId: options.requestId ?? null,
        parentRequestId: request.parentRequestId ?? null,
        repairAttempt: getRepairAttempt(mode, request.repairAttemptNumber),
        mode,
        phase: options.phase,
        rawUserRequest: getPromptLogRawUserRequest(request),
        currentSourceLen: request.currentSource.length,
        chatHistoryLen: request.chatHistory.length,
        requestBytes: options.requestBytes ?? null,
        compactedRequestBytes: options.compactedRequestBytes ?? null,
        omittedChatMessages: options.omittedChatMessages ?? null,
        inputShape: 'role-based',
        systemPromptHash: getSystemPromptHash(),
        modelInput: buildPromptLogModelInput(responseRequest),
        modelOutputRaw: coerceRawModelOutput(rawModelText),
        parsedEnvelope: options.parsedEnvelope ?? null,
        usage: options.usage,
        validationIssues: getPromptLogValidationIssues(request, options.validationIssues),
        errorCode: options.errorCode ?? getPromptLogErrorCode(options.error),
        errorMessage: getPromptLogErrorMessage(options.error),
        durationMs: options.durationMs,
      },
      {
        enabled: env.PROMPT_IO_LOG,
      },
    );
  } catch (error) {
    console.warn('[prompt-log] Failed to write prompt I/O failure log entry.', error);
  }
}

export async function writePromptIoIntakeFailureSafely(
  env: AppEnv,
  options: PromptIoRequestMetrics & {
    errorCode: string;
    errorMessage: string;
    partialBody?: unknown;
    requestId: string | null;
  },
) {
  const partialContext = getPartialPromptBuildContext(options.partialBody);

  try {
    await promptLog.writeFailure(
      {
        ts: new Date().toISOString(),
        requestId: options.requestId,
        parentRequestId: partialContext.parentRequestId,
        repairAttempt: getRepairAttempt(partialContext.mode, partialContext.repairAttemptNumber),
        mode: partialContext.mode,
        phase: 'intake',
        rawUserRequest: partialContext.rawUserRequest,
        currentSourceLen: partialContext.currentSourceLen,
        chatHistoryLen: partialContext.chatHistoryLen,
        requestBytes: options.requestBytes ?? null,
        compactedRequestBytes: options.compactedRequestBytes ?? null,
        omittedChatMessages: options.omittedChatMessages ?? null,
        inputShape: getPromptLogInputShape(partialContext.mode),
        validationIssues: partialContext.validationIssues,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
      },
      {
        enabled: env.PROMPT_IO_LOG,
      },
    );
  } catch (error) {
    console.warn('[prompt-log] Failed to write prompt intake failure log entry.', error);
  }
}

export async function writePromptIoCommitTelemetrySafely(
  env: AppEnv,
  options: {
    commitSource: PromptIoCommitSource;
    committed: boolean;
    parentRequestId: string | null;
    qualityWarnings?: string[];
    repairOutcome?: PromptIoRepairOutcome;
    requestId: string | null;
    validationIssues?: string[];
  },
) {
  try {
    await promptLog.write(
      {
        ts: new Date().toISOString(),
        requestId: options.requestId,
        parentRequestId: options.parentRequestId,
        repairAttempt: 0,
        mode: null,
        phase: 'client-commit',
        qualityWarnings: sanitizeValidationIssues(options.qualityWarnings),
        validationIssues: sanitizeValidationIssues(options.validationIssues),
        committed: options.committed,
        commitSource: options.commitSource,
        repairOutcome: options.repairOutcome,
      },
      {
        enabled: env.PROMPT_IO_LOG,
      },
    );
  } catch (error) {
    console.warn('[prompt-log] Failed to write prompt client commit telemetry entry.', error);
  }
}

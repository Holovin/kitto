import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '../../env.js';
import { toPublicErrorPayload } from '../../errors/publicError.js';
import { buildOpenUiRawUserRequest, type PromptBuildRequest } from '../../prompts/openui.js';
import { promptLog } from '../promptLog.js';
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

function getPromptLogValidationIssues(request: PromptBuildRequest, validationIssues?: string[]) {
  const mergedIssues = [...(request.validationIssues ?? []), ...(validationIssues ?? [])].filter(
    (issue): issue is string => typeof issue === 'string' && issue.trim().length > 0,
  );

  return mergedIssues.length > 0 ? [...new Set(mergedIssues)] : undefined;
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
    durationMs: number;
    parsedEnvelope: OpenUiGenerationEnvelope | null;
    requestId?: string | null;
    usage: unknown;
    validationIssues?: string[];
  },
) {
  try {
    await promptLog.write(
      {
        ts: new Date().toISOString(),
        requestId: options.requestId ?? null,
        parentRequestId: request.parentRequestId ?? null,
        mode: request.mode,
        rawUserRequest: getPromptLogRawUserRequest(request),
        currentSourceLen: request.currentSource.length,
        chatHistoryLen: request.chatHistory.length,
        systemPromptHash: getSystemPromptHash(env.LLM_STRUCTURED_OUTPUT),
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
    durationMs: number;
    error: unknown;
    parsedEnvelope?: OpenUiGenerationEnvelope | null;
    phase: 'request' | 'stream' | 'parse';
    requestId?: string | null;
    usage: unknown;
    validationIssues?: string[];
  },
) {
  try {
    await promptLog.writeFailure(
      {
        ts: new Date().toISOString(),
        requestId: options.requestId ?? null,
        parentRequestId: request.parentRequestId ?? null,
        mode: request.mode,
        rawUserRequest: getPromptLogRawUserRequest(request),
        currentSourceLen: request.currentSource.length,
        chatHistoryLen: request.chatHistory.length,
        systemPromptHash: getSystemPromptHash(env.LLM_STRUCTURED_OUTPUT),
        modelInput: buildPromptLogModelInput(responseRequest),
        modelOutputRaw: coerceRawModelOutput(rawModelText),
        parsedEnvelope: options.parsedEnvelope ?? null,
        usage: options.usage,
        validationIssues: getPromptLogValidationIssues(request, options.validationIssues),
        errorCode: getPromptLogErrorCode(options.error),
        errorMessage: getPromptLogErrorMessage(options.error),
        phase: options.phase,
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

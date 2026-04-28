import type { AppEnv } from '#backend/env.js';
import type { PromptBuildRequest } from '#backend/prompts/openui.js';
import {
  buildPromptContextSnapshot,
  buildResponseRequest,
  captureOpenAiRequestId,
  getClient,
  resetOpenAiClientForTesting,
  setOpenAiClientFactoryForTesting,
} from './client.js';
import {
  assertModelOutputWithinLimit,
  OpenUiGenerationEnvelopeSchema,
  parseOpenUiGenerationEnvelope,
  type OpenUiGenerationEnvelope,
} from './envelope.js';
import { logResponseUsage, writePromptIoFailureSafely, writePromptIoLogSafely } from './logging.js';
import {
  consumeOpenAiResponseStream,
  extractResponseText,
  isAbortedRequestError,
  type OpenAiResponseStreamState,
} from './streaming.js';

interface PromptIoRequestMetrics {
  compactedRequestBytes?: number | null;
  omittedChatMessages?: number | null;
  requestBytes?: number | null;
}

async function finalizeOpenUiModelResponse(
  env: AppEnv,
  request: PromptBuildRequest,
  responseRequest: ReturnType<typeof buildResponseRequest>,
  rawModelText: unknown,
  options: PromptIoRequestMetrics & {
    durationMs: number;
    requestId?: string | null;
    usage: unknown;
  },
) {
  let parsedEnvelope: OpenUiGenerationEnvelope | null = null;

  try {
    parsedEnvelope = parseOpenUiGenerationEnvelope(rawModelText, env);
    // Streaming enforces a raw envelope byte cap while deltas are in flight, but
    // structured responses still need a final extracted-source check here before
    // callers can treat the result as eligible for a `done` event or JSON reply.
    assertModelOutputWithinLimit(parsedEnvelope.source, env);
    await writePromptIoLogSafely(env, request, responseRequest, rawModelText, {
      compactedRequestBytes: options.compactedRequestBytes,
      omittedChatMessages: options.omittedChatMessages,
      durationMs: options.durationMs,
      parsedEnvelope,
      requestId: options.requestId,
      requestBytes: options.requestBytes,
      usage: options.usage,
    });
    return parsedEnvelope;
  } catch (error) {
    await writePromptIoFailureSafely(env, request, responseRequest, rawModelText, {
      compactedRequestBytes: options.compactedRequestBytes,
      omittedChatMessages: options.omittedChatMessages,
      durationMs: options.durationMs,
      error,
      parsedEnvelope,
      phase: 'parse',
      requestId: options.requestId,
      requestBytes: options.requestBytes,
      usage: options.usage,
    });
    throw error;
  }
}

export async function generateOpenUiSource(
  env: AppEnv,
  request: PromptBuildRequest,
  signal?: AbortSignal,
  telemetry?: {
    requestId?: string;
  } & PromptIoRequestMetrics,
) {
  const client = getClient(env);
  const responseRequest = buildResponseRequest(env, request);
  const startedAt = Date.now();
  let response;

  try {
    response = await client.responses.create(responseRequest, {
      signal,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isAbortedRequestError(error, signal)) {
      await writePromptIoFailureSafely(env, request, responseRequest, '', {
        compactedRequestBytes: telemetry?.compactedRequestBytes,
        omittedChatMessages: telemetry?.omittedChatMessages,
        durationMs: Date.now() - startedAt,
        error,
        phase: 'request',
        requestId: telemetry?.requestId,
        requestBytes: telemetry?.requestBytes,
        usage: null,
      });
    }

    throw error;
  }
  logResponseUsage(env, 'create', response);

  return finalizeOpenUiModelResponse(env, request, responseRequest, extractResponseText(response), {
    compactedRequestBytes: telemetry?.compactedRequestBytes,
    omittedChatMessages: telemetry?.omittedChatMessages,
    durationMs: Date.now() - startedAt,
    requestId: telemetry?.requestId,
    requestBytes: telemetry?.requestBytes,
    usage: response.usage,
  });
}

export async function streamOpenUiSource(
  env: AppEnv,
  request: PromptBuildRequest,
  onTextDelta: (delta: string) => Promise<void> | void,
  signal?: AbortSignal,
  telemetry?: {
    requestId?: string;
  } & PromptIoRequestMetrics,
) {
  const client = getClient(env);
  const responseRequest = buildResponseRequest(env, request);
  const startedAt = Date.now();
  let stream;
  let requestIdCapture: ReturnType<typeof captureOpenAiRequestId>['capture'] | null = null;

  try {
    const capturedStream = captureOpenAiRequestId(() =>
      client.responses.stream(responseRequest, {
        signal,
        timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
      }),
    );

    requestIdCapture = capturedStream.capture;
    stream = capturedStream.value;
  } catch (error) {
    if (!isAbortedRequestError(error, signal)) {
      await writePromptIoFailureSafely(env, request, responseRequest, '', {
        compactedRequestBytes: telemetry?.compactedRequestBytes,
        omittedChatMessages: telemetry?.omittedChatMessages,
        durationMs: Date.now() - startedAt,
        error,
        phase: 'request',
        requestId: telemetry?.requestId,
        requestBytes: telemetry?.requestBytes,
        usage: null,
      });
    }

    throw error;
  }

  const streamState: OpenAiResponseStreamState = {
    finalResponse: null,
    streamedText: '',
  };
  let finalResponseText: string | null = null;

  try {
    finalResponseText = await consumeOpenAiResponseStream(env, stream, onTextDelta, signal, streamState, {
      getRequestId: () => requestIdCapture?.requestId,
    });
    logResponseUsage(env, 'stream', streamState.finalResponse);
  } catch (error) {
    await writePromptIoFailureSafely(env, request, responseRequest, streamState.streamedText, {
      compactedRequestBytes: telemetry?.compactedRequestBytes,
      omittedChatMessages: telemetry?.omittedChatMessages,
      durationMs: Date.now() - startedAt,
      error,
      errorCode: isAbortedRequestError(error, signal) ? 'client_aborted' : undefined,
      phase: 'stream',
      requestId: telemetry?.requestId,
      requestBytes: telemetry?.requestBytes,
      usage: streamState.finalResponse?.usage ?? null,
    });

    throw error;
  }

  return finalizeOpenUiModelResponse(env, request, responseRequest, finalResponseText, {
    compactedRequestBytes: telemetry?.compactedRequestBytes,
    omittedChatMessages: telemetry?.omittedChatMessages,
    durationMs: Date.now() - startedAt,
    requestId: telemetry?.requestId,
    requestBytes: telemetry?.requestBytes,
    usage: streamState.finalResponse?.usage ?? null,
  });
}

export {
  OpenUiGenerationEnvelopeSchema,
  buildPromptContextSnapshot,
  parseOpenUiGenerationEnvelope,
  resetOpenAiClientForTesting,
  setOpenAiClientFactoryForTesting,
};
export type { OpenUiGenerationEnvelope };

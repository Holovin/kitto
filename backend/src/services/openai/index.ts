import type { AppEnv } from '../../env.js';
import type { PromptBuildRequest } from '../../prompts/openui.js';
import { buildResponseRequest, getClient, resetOpenAiClientForTesting, setOpenAiClientFactoryForTesting } from './client.js';
import {
  assertModelOutputWithinLimit,
  extractOpenUiEnvelopeFromModelText,
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

async function finalizeOpenUiModelResponse(
  env: AppEnv,
  request: PromptBuildRequest,
  responseRequest: ReturnType<typeof buildResponseRequest>,
  rawModelText: unknown,
  options: {
    durationMs: number;
    requestId?: string | null;
    usage: unknown;
  },
) {
  let parsedEnvelope: OpenUiGenerationEnvelope | null = null;

  try {
    parsedEnvelope = extractOpenUiEnvelopeFromModelText(rawModelText, env);
    assertModelOutputWithinLimit(parsedEnvelope.source, env);
    await writePromptIoLogSafely(env, request, responseRequest, rawModelText, {
      durationMs: options.durationMs,
      parsedEnvelope,
      requestId: options.requestId,
      usage: options.usage,
    });
    return parsedEnvelope;
  } catch (error) {
    await writePromptIoFailureSafely(env, request, responseRequest, rawModelText, {
      durationMs: options.durationMs,
      error,
      parsedEnvelope,
      phase: 'parse',
      requestId: options.requestId,
      usage: options.usage,
    });
    throw error;
  }
}

export async function generateOpenUiSource(
  env: AppEnv,
  request: PromptBuildRequest,
  signal?: AbortSignal,
  requestId?: string,
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
        durationMs: Date.now() - startedAt,
        error,
        phase: 'request',
        requestId,
        usage: null,
      });
    }

    throw error;
  }
  logResponseUsage(env, 'create', response);

  return finalizeOpenUiModelResponse(env, request, responseRequest, extractResponseText(response), {
    durationMs: Date.now() - startedAt,
    requestId,
    usage: response.usage,
  });
}

export async function streamOpenUiSource(
  env: AppEnv,
  request: PromptBuildRequest,
  onTextDelta: (delta: string) => Promise<void> | void,
  signal?: AbortSignal,
  requestId?: string,
) {
  const client = getClient(env);
  const responseRequest = buildResponseRequest(env, request);
  const startedAt = Date.now();
  let stream;

  try {
    stream = client.responses.stream(responseRequest, {
      signal,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isAbortedRequestError(error, signal)) {
      await writePromptIoFailureSafely(env, request, responseRequest, '', {
        durationMs: Date.now() - startedAt,
        error,
        phase: 'request',
        requestId,
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
    finalResponseText = await consumeOpenAiResponseStream(env, stream, onTextDelta, signal, streamState);
    logResponseUsage(env, 'stream', streamState.finalResponse);
  } catch (error) {
    if (!isAbortedRequestError(error, signal)) {
      await writePromptIoFailureSafely(env, request, responseRequest, streamState.streamedText, {
        durationMs: Date.now() - startedAt,
        error,
        phase: 'stream',
        requestId,
        usage: streamState.finalResponse?.usage ?? null,
      });
    }

    throw error;
  }

  return finalizeOpenUiModelResponse(env, request, responseRequest, finalResponseText, {
    durationMs: Date.now() - startedAt,
    requestId,
    usage: streamState.finalResponse?.usage ?? null,
  });
}

export {
  OpenUiGenerationEnvelopeSchema,
  parseOpenUiGenerationEnvelope,
  resetOpenAiClientForTesting,
  setOpenAiClientFactoryForTesting,
};
export type { OpenUiGenerationEnvelope };

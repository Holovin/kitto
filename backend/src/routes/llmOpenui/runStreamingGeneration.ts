import type { Context } from 'hono';
import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import type { AppEnv } from '#backend/env.js';
import { streamOpenUiSource, type OpenUiGenerationEnvelope } from '#backend/services/openai.js';
import { mapToPublicError } from './mapToPublicError.js';
import { parseLlmRequest } from './requestSchema.js';
import { createLlmResponsePayload } from './runGeneration.js';
import type { LlmOpenUiTelemetry } from './telemetry.js';

const STREAM_SCOPE = 'POST /api/llm/generate/stream';

type SseEventWriter = (event: string, data: string) => boolean;

interface StreamingGenerationOptions {
  onCompletedGeneration?: (invocation: Awaited<ReturnType<typeof parseLlmRequest>>) => void;
  onPreActivityStreamFailure?: () => void;
}

function isAbortError(error: unknown) {
  return (
    error instanceof APIUserAbortError ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'APIUserAbortError' || error.message === 'This operation was aborted'))
  );
}

function isPreActivityFallbackEligibleError(error: unknown) {
  return (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError ||
    (error instanceof Error && (error.name === 'APIConnectionError' || error.name === 'APIConnectionTimeoutError' || error.name === 'TimeoutError'))
  );
}

function formatSseEvent(event: string, data: string) {
  const payload = data
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n');

  return `event: ${event}\n${payload}\n\n`;
}

function handleStreamingError(
  error: unknown,
  abortController: AbortController,
  closeController: () => void,
  writeEvent: SseEventWriter,
) {
  if (isAbortError(error) || abortController.signal.aborted) {
    closeController();
    return;
  }

  writeEvent('error', JSON.stringify(mapToPublicError(error, STREAM_SCOPE)));
  closeController();
}

function createStreamingResponse(
  context: Context,
  env: AppEnv,
  telemetry: LlmOpenUiTelemetry,
  invocation: Awaited<ReturnType<typeof parseLlmRequest>>,
  options: StreamingGenerationOptions = {},
) {
  const abortController = new AbortController();
  const encoder = new TextEncoder();
  let isClosed = false;
  let hasWrittenStreamActivity = false;
  let closeController = () => {
    // Assigned after the stream controller is available.
  };
  const handleClientAbort = () => {
    abortController.abort();
    closeController();
  };
  const stream = new ReadableStream({
    start(controller) {
      closeController = () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        context.req.raw.signal.removeEventListener('abort', handleClientAbort);

        try {
          controller.close();
        } catch {
          // Ignore close errors after the client has already gone away.
        }
      };
      const writeEvent: SseEventWriter = (event, data) => {
        if (isClosed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(formatSseEvent(event, data)));
          if (event === 'chunk' || event === 'done') {
            hasWrittenStreamActivity = true;
          }
          return true;
        } catch {
          abortController.abort();
          closeController();
          return false;
        }
      };

      context.req.raw.signal.addEventListener('abort', handleClientAbort, { once: true });

      void (async () => {
        try {
          const responseEnvelope: OpenUiGenerationEnvelope = await streamOpenUiSource(
            env,
            invocation.request,
            (delta) => {
              if (!abortController.signal.aborted) {
                writeEvent('chunk', delta);
              }
            },
            abortController.signal,
            {
              compactedRequestBytes: invocation.compactedRequestBytes,
              omittedChatMessages: invocation.omittedChatMessages,
              requestBytes: invocation.requestBytes,
              requestId: invocation.requestId,
            },
          );

          if (abortController.signal.aborted) {
            closeController();
            return;
          }

          const didWriteDoneEvent = writeEvent(
            'done',
            JSON.stringify(createLlmResponsePayload(env, invocation, responseEnvelope)),
          );

          if (didWriteDoneEvent) {
            telemetry.recordModelResponse(invocation.requestId);
            options.onCompletedGeneration?.(invocation);
          }

          closeController();
        } catch (error) {
          if (
            !hasWrittenStreamActivity &&
            !isAbortError(error) &&
            isPreActivityFallbackEligibleError(error) &&
            !abortController.signal.aborted &&
            !context.req.raw.signal.aborted
          ) {
            options.onPreActivityStreamFailure?.();
          }

          handleStreamingError(error, abortController, closeController, writeEvent);
        }
      })();
    },
    cancel() {
      closeController();
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function runStreamingGeneration(
  context: Context,
  env: AppEnv,
  telemetry: LlmOpenUiTelemetry,
  options: StreamingGenerationOptions = {},
) {
  try {
    const invocation = await parseLlmRequest(context, env, telemetry);
    return createStreamingResponse(context, env, telemetry, invocation, options);
  } catch (error) {
    const publicError = mapToPublicError(error, STREAM_SCOPE);
    return context.json(publicError, publicError.status);
  }
}

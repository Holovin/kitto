import { Hono, type Context } from 'hono';
import { APIUserAbortError } from 'openai';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { logServerError, RequestValidationError, toPublicErrorPayload, UpstreamFailureError } from '../errors/publicError.js';
import { getByteLength } from '../limits.js';
import { createInMemoryRateLimitMiddleware } from '../middleware/rateLimit.js';
import { generateOpenUiSource, streamOpenUiSource } from '../services/openai.js';

interface LlmRequestCompaction {
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

interface ParsedLlmRequest {
  chatHistory: Array<{
    content: string;
    role: 'assistant' | 'user';
  }>;
  currentSource: string;
  prompt: string;
}

interface RawParsedLlmRequest {
  chatHistory: Array<{
    content: string;
    role: 'assistant' | 'system' | 'user';
  }>;
  currentSource: string;
  prompt: string;
}

interface ParsedLlmRequestResult {
  compaction?: LlmRequestCompaction;
  request: ParsedLlmRequest;
}

function createLlmRequestSchema(env: AppEnv) {
  return z.object({
    prompt: z
      .string()
      .min(1, 'Prompt must not be empty.')
      .max(env.LLM_PROMPT_MAX_CHARS, `Prompt is too large. Limit: ${env.LLM_PROMPT_MAX_CHARS} characters.`),
    currentSource: z.string().default(''),
    chatHistory: z
      .array(
        z.object({
          role: z.enum(['assistant', 'system', 'user']),
          content: z.string(),
        }),
      )
      .default([]),
  });
}

function isConversationChatMessage(
  message: RawParsedLlmRequest['chatHistory'][number],
): message is ParsedLlmRequest['chatHistory'][number] {
  return message.role === 'assistant' || message.role === 'user';
}

function sanitizeLlmRequest(request: RawParsedLlmRequest): ParsedLlmRequest {
  return {
    ...request,
    chatHistory: request.chatHistory.filter(isConversationChatMessage),
  };
}

function isAbortError(error: unknown) {
  return (
    error instanceof APIUserAbortError ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'APIUserAbortError' || error.message === 'This operation was aborted'))
  );
}

function formatSseEvent(event: string, data: string) {
  const payload = data
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n');

  return `event: ${event}\n${payload}\n\n`;
}

function getRequestSizeBytes(request: ParsedLlmRequest) {
  return getByteLength(JSON.stringify(request));
}

function compactLlmRequest(request: ParsedLlmRequest, env: AppEnv): ParsedLlmRequestResult {
  let compactedByBytes = false;
  let compactedByItemLimit = false;
  let omittedChatMessages = 0;
  let chatHistory = request.chatHistory;

  if (chatHistory.length > env.LLM_CHAT_HISTORY_MAX_ITEMS) {
    omittedChatMessages += chatHistory.length - env.LLM_CHAT_HISTORY_MAX_ITEMS;
    compactedByItemLimit = true;
    chatHistory = chatHistory.slice(-env.LLM_CHAT_HISTORY_MAX_ITEMS);
  }

  let compactedRequest: ParsedLlmRequest = {
    ...request,
    chatHistory,
  };

  while (getRequestSizeBytes(compactedRequest) > env.LLM_REQUEST_MAX_BYTES && compactedRequest.chatHistory.length > 0) {
    compactedByBytes = true;
    omittedChatMessages += 1;
    compactedRequest = {
      ...compactedRequest,
      chatHistory: compactedRequest.chatHistory.slice(1),
    };
  }

  return {
    compaction:
      omittedChatMessages > 0
        ? {
            compactedByBytes,
            compactedByItemLimit,
            omittedChatMessages,
          }
        : undefined,
    request: compactedRequest,
  };
}

function assertModelOutputWithinLimit(source: string, env: AppEnv) {
  const outputSizeBytes = getByteLength(source);

  if (outputSizeBytes > env.LLM_OUTPUT_MAX_BYTES) {
    throw new UpstreamFailureError(
      `Model output size ${outputSizeBytes} bytes exceeded the backend limit of ${env.LLM_OUTPUT_MAX_BYTES} bytes.`,
    );
  }
}

async function parseLlmRequest(context: Context, env: AppEnv) {
  const rawBody = await context.req.text();

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('Request body could not be parsed as JSON.', 400, {
      publicMessage: 'Request body must be valid JSON.',
    });
  }

  const request = sanitizeLlmRequest(createLlmRequestSchema(env).parse(parsedBody));
  const compactedRequest = compactLlmRequest(request, env);

  if (getRequestSizeBytes(compactedRequest.request) > env.LLM_REQUEST_MAX_BYTES) {
    throw new RequestValidationError(`Compacted request still exceeded the safe request limit of ${env.LLM_REQUEST_MAX_BYTES} bytes.`, 413, {
      publicMessage: 'Request body is too large to process safely.',
    });
  }

  return compactedRequest;
}

export function createLlmOpenUiRoutes(env: AppEnv) {
  const llmRoutes = new Hono();
  const rateLimitMiddleware = createInMemoryRateLimitMiddleware({
    maxEntries: env.LLM_RATE_LIMIT_MAX_ENTRIES,
    maxRequests: env.LLM_RATE_LIMIT_MAX_REQUESTS,
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });

  llmRoutes.use('*', rateLimitMiddleware);

  llmRoutes.post('/llm/generate', async (context) => {
    try {
      const { compaction, request } = await parseLlmRequest(context, env);
      const source = await generateOpenUiSource(env, request, context.req.raw.signal);
      assertModelOutputWithinLimit(source, env);

      return context.json({
        compaction,
        model: env.OPENAI_MODEL,
        source,
      });
    } catch (error) {
      logServerError(error, 'POST /api/llm/generate');
      const publicError = toPublicErrorPayload(error);
      return context.json(publicError, publicError.status);
    }
  });

  llmRoutes.post('/llm/generate/stream', async (context) => {
    try {
      const { compaction, request } = await parseLlmRequest(context, env);
      const abortController = new AbortController();
      const encoder = new TextEncoder();
      let isClosed = false;
      let closeController = () => {
        // Assigned inside the stream start callback once the controller exists.
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
          const writeEvent = (event: string, data: string) => {
            if (isClosed) {
              return;
            }

            try {
              controller.enqueue(encoder.encode(formatSseEvent(event, data)));
            } catch {
              abortController.abort();
              closeController();
            }
          };

          context.req.raw.signal.addEventListener('abort', handleClientAbort, { once: true });

          void (async () => {
            try {
              const source = await streamOpenUiSource(
                env,
                request,
                (delta) => {
                  if (abortController.signal.aborted) {
                    return;
                  }

                  writeEvent('chunk', delta);
                },
                abortController.signal,
              );

              if (abortController.signal.aborted) {
                closeController();
                return;
              }

              assertModelOutputWithinLimit(source, env);
              writeEvent(
                'done',
                JSON.stringify({
                  compaction,
                  model: env.OPENAI_MODEL,
                  source,
                }),
              );
              closeController();
            } catch (error) {
              if (isAbortError(error) || abortController.signal.aborted) {
                closeController();
                return;
              }

              logServerError(error, 'POST /api/llm/generate/stream');
              writeEvent('error', JSON.stringify(toPublicErrorPayload(error)));
              closeController();
            }
          })();
        },
        cancel() {
          isClosed = true;
          context.req.raw.signal.removeEventListener('abort', handleClientAbort);
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
    } catch (error) {
      logServerError(error, 'POST /api/llm/generate/stream');
      const publicError = toPublicErrorPayload(error);
      return context.json(publicError, publicError.status);
    }
  });

  return llmRoutes;
}

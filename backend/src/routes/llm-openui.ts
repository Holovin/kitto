import { Hono, type Context } from 'hono';
import { APIUserAbortError } from 'openai';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { logServerError, RequestValidationError, toPublicErrorPayload } from '../errors/publicError.js';
import { createInMemoryRateLimitMiddleware } from '../middleware/rateLimit.js';
import { generateOpenUiSource, streamOpenUiSource } from '../services/openai.js';
const RAW_REQUEST_MAX_BYTES_MULTIPLIER = 4;
const textEncoder = new TextEncoder();

interface LlmRequestCompaction {
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

interface ParsedLlmRequest {
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
  return textEncoder.encode(JSON.stringify(request)).byteLength;
}

function getRawRequestMaxBytes(env: AppEnv) {
  return env.LLM_REQUEST_MAX_BYTES * RAW_REQUEST_MAX_BYTES_MULTIPLIER;
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

async function parseLlmRequest(context: Context, env: AppEnv) {
  const contentLengthHeader = context.req.header('content-length');
  const rawRequestMaxBytes = getRawRequestMaxBytes(env);

  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);

    if (Number.isFinite(contentLength) && contentLength > rawRequestMaxBytes) {
      throw new RequestValidationError(`Content-Length ${contentLength} exceeded the raw request limit of ${rawRequestMaxBytes} bytes.`, 413, {
        publicMessage: 'Request body is too large to process safely.',
      });
    }
  }

  const rawBody = await context.req.text();
  const rawBodyBytes = textEncoder.encode(rawBody).byteLength;

  if (rawBodyBytes > rawRequestMaxBytes) {
    throw new RequestValidationError(`Request body size ${rawBodyBytes} bytes exceeded the raw request limit of ${rawRequestMaxBytes} bytes.`, 413, {
      publicMessage: 'Request body is too large to process safely.',
    });
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('Request body could not be parsed as JSON.', 400, {
      publicMessage: 'Request body must be valid JSON.',
    });
  }

  const request = createLlmRequestSchema(env).parse(parsedBody);
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
    maxRequests: env.LLM_RATE_LIMIT_MAX_REQUESTS,
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });

  llmRoutes.use('*', rateLimitMiddleware);

  llmRoutes.post('/llm/generate', async (context) => {
    try {
      const { compaction, request } = await parseLlmRequest(context, env);
      const source = await generateOpenUiSource(env, request, context.req.raw.signal);

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
      const handleClientAbort = () => abortController.abort();
      let isClosed = false;
      const stream = new ReadableStream({
        start(controller) {
          const closeController = () => {
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
              let streamedSource = '';
              const finalSource = await streamOpenUiSource(
                env,
                request,
                (delta) => {
                  streamedSource += delta;
                  writeEvent('chunk', delta);
                },
                abortController.signal,
              );

              if (abortController.signal.aborted) {
                closeController();
                return;
              }

              writeEvent(
                'done',
                JSON.stringify({
                  compaction,
                  model: env.OPENAI_MODEL,
                  source: finalSource || streamedSource,
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

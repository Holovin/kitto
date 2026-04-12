import { Hono, type Context } from 'hono';
import { ZodError, z } from 'zod';
import type { AppEnv } from '../env.js';
import { createInMemoryRateLimitMiddleware } from '../middleware/rateLimit.js';
import { generateOpenUiSource, streamOpenUiSource } from '../services/openai.js';

class RequestValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RequestValidationError';
    this.status = status;
  }
}

type LlmRouteErrorStatus = 400 | 413 | 500;
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

function getErrorMessage(error: unknown) {
  if (error instanceof RequestValidationError) {
    return error.message;
  }

  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? 'The LLM request payload did not match the expected shape.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected backend error.';
}

function getErrorStatus(error: unknown) {
  if (error instanceof RequestValidationError) {
    return error.status as LlmRouteErrorStatus;
  }

  if (error instanceof ZodError) {
    return 400 satisfies LlmRouteErrorStatus;
  }

  return 500 satisfies LlmRouteErrorStatus;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted');
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
      throw new RequestValidationError('Request body is too large to process safely.', 413);
    }
  }

  const rawBody = await context.req.text();
  const rawBodyBytes = textEncoder.encode(rawBody).byteLength;

  if (rawBodyBytes > rawRequestMaxBytes) {
    throw new RequestValidationError('Request body is too large to process safely.', 413);
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.');
  }

  const request = createLlmRequestSchema(env).parse(parsedBody);
  const compactedRequest = compactLlmRequest(request, env);

  if (getRequestSizeBytes(compactedRequest.request) > env.LLM_REQUEST_MAX_BYTES) {
    throw new RequestValidationError(`Request body is too large. Limit: ${env.LLM_REQUEST_MAX_BYTES} bytes.`, 413);
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
      return context.json(
        {
          error: getErrorMessage(error),
        },
        getErrorStatus(error),
      );
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

              writeEvent('error', getErrorMessage(error));
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
      return context.json(
        {
          error: getErrorMessage(error),
        },
        getErrorStatus(error),
      );
    }
  });

  return llmRoutes;
}

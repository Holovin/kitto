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

function createLlmRequestSchema(env: AppEnv) {
  return z.object({
    prompt: z
      .string()
      .min(1, 'Prompt must not be empty.')
      .max(env.LLM_PROMPT_MAX_CHARS, `Prompt is too large. Limit: ${env.LLM_PROMPT_MAX_CHARS} characters.`),
    currentSource: z
      .string()
      .max(env.LLM_CURRENT_SOURCE_MAX_CHARS, `Current source is too large. Limit: ${env.LLM_CURRENT_SOURCE_MAX_CHARS} characters.`)
      .default(''),
    chatHistory: z
      .array(
        z.object({
          role: z.enum(['assistant', 'system', 'user']),
          content: z.string().max(env.LLM_CHAT_MESSAGE_MAX_CHARS, `Chat message is too large. Limit: ${env.LLM_CHAT_MESSAGE_MAX_CHARS} characters.`),
        }),
      )
      .max(env.LLM_CHAT_HISTORY_MAX_ITEMS, `Chat history is too large. Limit: ${env.LLM_CHAT_HISTORY_MAX_ITEMS} messages.`)
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

async function parseLlmRequest(context: Context, env: AppEnv) {
  const contentLengthHeader = context.req.header('content-length');

  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);

    if (Number.isFinite(contentLength) && contentLength > env.LLM_REQUEST_MAX_BYTES) {
      throw new RequestValidationError(`Request body is too large. Limit: ${env.LLM_REQUEST_MAX_BYTES} bytes.`, 413);
    }
  }

  const rawBody = await context.req.text();
  const rawBodyBytes = new TextEncoder().encode(rawBody).byteLength;

  if (rawBodyBytes > env.LLM_REQUEST_MAX_BYTES) {
    throw new RequestValidationError(`Request body is too large. Limit: ${env.LLM_REQUEST_MAX_BYTES} bytes.`, 413);
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.');
  }

  return createLlmRequestSchema(env).parse(parsedBody);
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
      const request = await parseLlmRequest(context, env);
      const source = await generateOpenUiSource(env, request, context.req.raw.signal);

      return context.json({
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
      const request = await parseLlmRequest(context, env);
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

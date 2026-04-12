import { Hono } from 'hono';
import { z } from 'zod';
import { type Spec } from '@json-render/core';
import { GenerateSpecInput, generateSpec, streamSpec } from '../services/openai.js';
import { env, isOpenAIConfigured } from '../env.js';

const builderMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1),
});

const specSchema = z
  .object({
    root: z.string(),
    elements: z.record(z.string(), z.unknown()),
  })
  .passthrough() as z.ZodType<Spec>;
const repairContextSchema = z.object({
  attempt: z.number().int().positive(),
  error: z.string().trim().min(1),
  rawLines: z.array(z.string().trim().min(1)).optional(),
});
const contextSchema = z
  .object({
    messages: z.array(builderMessageSchema).optional(),
    runtimeState: z.record(z.string(), z.unknown()).nullable().optional(),
    previousSpec: specSchema.nullable().optional(),
    repairContext: repairContextSchema.optional(),
  })
  .passthrough();

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  messages: z.array(builderMessageSchema).optional(),
  currentSpec: specSchema.nullable().optional(),
  runtimeState: z.record(z.string(), z.unknown()).nullable().optional(),
  repairContext: repairContextSchema.optional(),
  context: contextSchema.optional(),
});

type JsonErrorHeaders = Record<string, string>;
type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const llmRateLimitEntries = new Map<string, RateLimitEntry>();

function createJsonError(message: string, status = 400, headers: JsonErrorHeaders = {}) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function getRateLimitKey(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'anonymous';
  }

  return request.headers.get('cf-connecting-ip') ?? 'anonymous';
}

function pruneExpiredRateLimitEntries(now: number) {
  for (const [key, entry] of llmRateLimitEntries) {
    if (entry.resetAt <= now) {
      llmRateLimitEntries.delete(key);
    }
  }
}

async function parseGenerateInput(request: Request): Promise<GenerateSpecInput> {
  const json = await request.json();
  const parsed = generateRequestSchema.parse(json);

  return {
    prompt: parsed.prompt,
    messages: parsed.messages ?? parsed.context?.messages,
    currentSpec: parsed.currentSpec ?? parsed.context?.previousSpec ?? null,
    runtimeState: parsed.runtimeState ?? parsed.context?.runtimeState ?? null,
    repairContext: parsed.repairContext ?? parsed.context?.repairContext,
  };
}

export const llmJsonRenderRoute = new Hono();

llmJsonRenderRoute.use('*', async (c, next) => {
  const now = Date.now();
  const key = getRateLimitKey(c.req.raw);
  const currentEntry = llmRateLimitEntries.get(key);
  const hasActiveWindow = Boolean(currentEntry && currentEntry.resetAt > now);
  const resetAt = hasActiveWindow ? currentEntry!.resetAt : now + env.LLM_RATE_LIMIT_WINDOW_MS;
  const nextCount = hasActiveWindow ? currentEntry!.count + 1 : 1;
  const remaining = Math.max(env.LLM_RATE_LIMIT_MAX_REQUESTS - nextCount, 0);
  const resetInSeconds = Math.max(Math.ceil((resetAt - now) / 1_000), 1);

  pruneExpiredRateLimitEntries(now);

  if (nextCount > env.LLM_RATE_LIMIT_MAX_REQUESTS) {
    return createJsonError('Rate limit exceeded.', 429, {
      'Retry-After': String(resetInSeconds),
      'X-RateLimit-Limit': String(env.LLM_RATE_LIMIT_MAX_REQUESTS),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(resetAt),
    });
  }

  llmRateLimitEntries.set(key, {
    count: nextCount,
    resetAt,
  });

  await next();

  c.res.headers.set('X-RateLimit-Limit', String(env.LLM_RATE_LIMIT_MAX_REQUESTS));
  c.res.headers.set('X-RateLimit-Remaining', String(remaining));
  c.res.headers.set('X-RateLimit-Reset', String(resetAt));
});

llmJsonRenderRoute.post('/llm/generate', async (c) => {
  if (!isOpenAIConfigured()) {
    return createJsonError('OPENAI_API_KEY is missing on the backend.', 503);
  }

  try {
    const input = await parseGenerateInput(c.req.raw);
    const result = await generateSpec(input);

    return c.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createJsonError(error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const message = error instanceof Error ? error.message : 'Unknown generation error.';
    return createJsonError(message, 500);
  }
});

llmJsonRenderRoute.post('/llm/generate/stream', async (c) => {
  if (!isOpenAIConfigured()) {
    return createJsonError('OPENAI_API_KEY is missing on the backend.', 503);
  }

  try {
    const input = await parseGenerateInput(c.req.raw);
    const { stream } = streamSpec(input);
    const encoder = new TextEncoder();
    const abortSignal = c.req.raw.signal;
    const abortStream = () => {
      stream.abort();
    };

    abortSignal.addEventListener('abort', abortStream, { once: true });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = '';

        try {
          for await (const event of stream) {
            if (event.type !== 'response.output_text.delta') {
              continue;
            }

            buffer += event.delta;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) {
                continue;
              }

              controller.enqueue(encoder.encode(`${trimmed}\n`));
            }
          }

          if (buffer.trim()) {
            controller.enqueue(encoder.encode(`${buffer.trim()}\n`));
          }

          const finalResponse = await stream.finalResponse();
          const usage = finalResponse.usage
            ? {
                __meta: 'usage',
                promptTokens: finalResponse.usage.input_tokens,
                completionTokens: finalResponse.usage.output_tokens,
                totalTokens: finalResponse.usage.total_tokens,
              }
            : null;

          if (usage) {
            controller.enqueue(encoder.encode(`${JSON.stringify(usage)}\n`));
          }

          controller.close();
        } catch (error) {
          if (abortSignal.aborted) {
            return;
          }

          controller.error(error);
        } finally {
          abortSignal.removeEventListener('abort', abortStream);
        }
      },
      cancel() {
        abortSignal.removeEventListener('abort', abortStream);
        stream.abort();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createJsonError(error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const message = error instanceof Error ? error.message : 'Unknown streaming error.';
    return createJsonError(message, 500);
  }
});

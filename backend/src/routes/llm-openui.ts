import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { getByteLength } from '../limits.js';
import { createInMemoryRateLimitMiddleware } from '../middleware/rateLimit.js';
import { getRequestBytesFromContext, getRequestIdFromContext } from '../requestMetadata.js';
import { createCommitTelemetryHandler, createLlmOpenUiTelemetry } from './llmOpenui/telemetry.js';
import { runGeneration } from './llmOpenui/runGeneration.js';
import { runStreamingGeneration } from './llmOpenui/runStreamingGeneration.js';

export function createLlmOpenUiRoutes(env: AppEnv) {
  const llmRoutes = new Hono();
  const telemetry = createLlmOpenUiTelemetry(env);
  const rateLimitMiddleware = createInMemoryRateLimitMiddleware({
    maxEntries: env.LLM_RATE_LIMIT_MAX_ENTRIES,
    maxRequests: env.LLM_RATE_LIMIT_MAX_REQUESTS,
    onRejected: async (context) => {
      await telemetry.recordIntake({
        errorCode: 'rate_limited',
        errorMessage: 'Too many LLM requests. Please wait a moment and try again.',
        requestBytes: getRequestBytesFromContext(context) ?? getByteLength(await context.req.text()),
        requestId: getRequestIdFromContext(context),
      });
    },
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });

  llmRoutes.use('/llm/generate', rateLimitMiddleware);
  llmRoutes.use('/llm/generate/stream', rateLimitMiddleware);

  llmRoutes.post('/llm/generate', (context) => runGeneration(context, env, telemetry));
  llmRoutes.post('/llm/generate/stream', (context) => runStreamingGeneration(context, env, telemetry));
  llmRoutes.post('/llm/commit-telemetry', createCommitTelemetryHandler(telemetry));

  return llmRoutes;
}

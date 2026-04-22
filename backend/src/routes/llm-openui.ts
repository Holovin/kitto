import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env.js';
import { getByteLength } from '../limits.js';
import { createInMemoryRateLimitMiddleware } from '../middleware/rateLimit.js';
import { getRequestBytesFromContext, getRequestIdFromContext } from '../requestMetadata.js';
import { createCommitTelemetryHandler, createLlmOpenUiTelemetry } from './llmOpenui/telemetry.js';
import { runGeneration } from './llmOpenui/runGeneration.js';
import { runStreamingGeneration } from './llmOpenui/runStreamingGeneration.js';

const AUTOMATIC_REPAIR_HEADER = 'x-kitto-automatic-repair';

export function createLlmOpenUiRoutes(env: AppEnv) {
  const llmRoutes = new Hono();
  const telemetry = createLlmOpenUiTelemetry(env);
  const createRateLimitRejectionRecorder = async (context: Context) => {
    await telemetry.recordIntake({
      errorCode: 'rate_limited',
      errorMessage: 'Too many LLM requests. Please wait a moment and try again.',
      requestBytes: getRequestBytesFromContext(context) ?? getByteLength(await context.req.text()),
      requestId: getRequestIdFromContext(context),
    });
  };
  const generateRateLimitMiddleware = createInMemoryRateLimitMiddleware({
    maxEntries: env.LLM_RATE_LIMIT_MAX_ENTRIES,
    maxRequests: env.LLM_RATE_LIMIT_MAX_REQUESTS,
    onRejected: createRateLimitRejectionRecorder,
    shouldCount: (context) => context.req.header(AUTOMATIC_REPAIR_HEADER) !== '1',
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });
  const streamRateLimitMiddleware = createInMemoryRateLimitMiddleware({
    maxEntries: env.LLM_RATE_LIMIT_MAX_ENTRIES,
    maxRequests: env.LLM_RATE_LIMIT_MAX_REQUESTS,
    onRejected: createRateLimitRejectionRecorder,
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });

  llmRoutes.use('/llm/generate', generateRateLimitMiddleware);
  llmRoutes.use('/llm/generate/stream', streamRateLimitMiddleware);

  llmRoutes.post('/llm/generate', (context) => runGeneration(context, env, telemetry));
  llmRoutes.post('/llm/generate/stream', (context) => runStreamingGeneration(context, env, telemetry));
  llmRoutes.post('/llm/commit-telemetry', createCommitTelemetryHandler(telemetry));

  return llmRoutes;
}

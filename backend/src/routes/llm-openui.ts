import { Hono, type Context } from 'hono';
import type { AppEnv } from '#backend/env.js';
import { normalizeHeaderValue, parsePositiveIntegerHeader } from '#backend/httpHeaders.js';
import { createInMemoryRateLimitMiddleware } from '#backend/middleware/rateLimit.js';
import {
  getClientProvidedRequestIdFromContext,
  getRequestBytesFromContext,
  getRequestIdFromContext,
} from '#backend/requestMetadata.js';
import type { PreparedLlmInvocation } from '#backend/routes/llmOpenui/requestSchema.js';
import { createCommitTelemetryHandler, createLlmOpenUiTelemetry } from '#backend/routes/llmOpenui/telemetry.js';
import { runGeneration } from '#backend/routes/llmOpenui/runGeneration.js';
import { runStreamingGeneration } from '#backend/routes/llmOpenui/runStreamingGeneration.js';
import {
  AUTOMATIC_REPAIR_ATTEMPT_HEADER,
  AUTOMATIC_REPAIR_FOR_HEADER,
  AUTOMATIC_REPAIR_HEADER,
  STREAM_FALLBACK_HEADER,
} from '#backend/routes/llmOpenui/transportHeaders.js';

function isGenerateRoute(context: Context) {
  return context.req.path.endsWith('/llm/generate');
}

function createGenerationContinuationRateLimitRegistry({
  maxEntries,
  windowMs,
}: {
  maxEntries: number;
  windowMs: number;
}) {
  const entries = new Map<string, number>();

  function getKey(kind: string, requestId: string, attemptNumber?: number) {
    return `${kind}\0${requestId}\0${attemptNumber ?? ''}`;
  }

  function pruneExpiredEntries(now: number) {
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= now) {
        entries.delete(key);
      }
    }
  }

  function trimOverflowEntries() {
    if (entries.size <= maxEntries) {
      return;
    }

    for (const key of entries.keys()) {
      entries.delete(key);

      if (entries.size <= maxEntries) {
        return;
      }
    }
  }

  function recordKey(key: string | null) {
    if (!key || maxEntries <= 0) {
      return;
    }

    const now = Date.now();
    pruneExpiredEntries(now);
    entries.set(key, now + windowMs);
    trimOverflowEntries();
  }

  function consumeKey(key: string | null) {
    if (!key) {
      return false;
    }

    const now = Date.now();
    pruneExpiredEntries(now);

    const expiresAt = entries.get(key);

    if (!expiresAt || expiresAt <= now) {
      entries.delete(key);
      return false;
    }

    entries.delete(key);
    return true;
  }

  function getStreamFallbackKey(context: Context) {
    const requestId = getClientProvidedRequestIdFromContext(context);
    return requestId ? getKey('stream-fallback', requestId) : null;
  }

  function getAutomaticRepairKey(context: Context) {
    if (context.req.header(AUTOMATIC_REPAIR_HEADER) !== '1') {
      return null;
    }

    const parentRequestId = normalizeHeaderValue(context.req.header(AUTOMATIC_REPAIR_FOR_HEADER));
    const attemptNumber = parsePositiveIntegerHeader(context.req.header(AUTOMATIC_REPAIR_ATTEMPT_HEADER));

    if (!parentRequestId || attemptNumber === null) {
      return null;
    }

    return getKey('automatic-repair', parentRequestId, attemptNumber);
  }

  return {
    consume(context: Context) {
      if (!isGenerateRoute(context)) {
        return false;
      }

      if (context.req.header(STREAM_FALLBACK_HEADER) === '1') {
        return consumeKey(getStreamFallbackKey(context));
      }

      return consumeKey(getAutomaticRepairKey(context));
    },
    recordAutomaticRepair(parentRequestId: string, attemptNumber: number) {
      recordKey(getKey('automatic-repair', parentRequestId, attemptNumber));
    },
    recordStreamFallback(context: Context) {
      recordKey(getStreamFallbackKey(context));
    },
  };
}

function getNextAutomaticRepairCredit(invocation: PreparedLlmInvocation, maxRepairAttempts: number) {
  if (invocation.request.mode === 'repair') {
    if (!invocation.request.parentRequestId || !invocation.request.repairAttemptNumber) {
      return null;
    }

    const nextAttemptNumber = invocation.request.repairAttemptNumber + 1;

    if (nextAttemptNumber > maxRepairAttempts) {
      return null;
    }

    return {
      attemptNumber: nextAttemptNumber,
      parentRequestId: invocation.request.parentRequestId,
    };
  }

  return {
    attemptNumber: 1,
    parentRequestId: invocation.requestId,
  };
}

export function createLlmOpenUiRoutes(env: AppEnv) {
  const llmRoutes = new Hono();
  const telemetry = createLlmOpenUiTelemetry(env);
  const continuationRateLimitRegistry = createGenerationContinuationRateLimitRegistry({
    maxEntries: env.LLM_RATE_LIMIT_MAX_ENTRIES,
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });
  const recordAutomaticRepairCredit = (invocation: PreparedLlmInvocation) => {
    const credit = getNextAutomaticRepairCredit(invocation, env.LLM_MAX_REPAIR_ATTEMPTS);

    if (!credit) {
      return;
    }

    continuationRateLimitRegistry.recordAutomaticRepair(credit.parentRequestId, credit.attemptNumber);
  };
  const createRateLimitRejectionRecorder = async (context: Context) => {
    await telemetry.recordIntake({
      errorCode: 'rate_limited',
      errorMessage: 'Too many LLM requests. Please wait a moment and try again.',
      requestBytes: getRequestBytesFromContext(context),
      requestId: getRequestIdFromContext(context),
    });
  };
  const generationRateLimitMiddleware = createInMemoryRateLimitMiddleware({
    maxRequests: env.LLM_RATE_LIMIT_MAX_REQUESTS,
    onRejected: createRateLimitRejectionRecorder,
    shouldCount: (context) => !continuationRateLimitRegistry.consume(context),
    windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  });

  llmRoutes.use('/llm/generate', generationRateLimitMiddleware);
  llmRoutes.use('/llm/generate/stream', generationRateLimitMiddleware);

  llmRoutes.post('/llm/generate', (context) =>
    runGeneration(context, env, telemetry, {
      onCompletedGeneration: recordAutomaticRepairCredit,
    }),
  );
  llmRoutes.post('/llm/generate/stream', (context) =>
    runStreamingGeneration(context, env, telemetry, {
      onCompletedGeneration: recordAutomaticRepairCredit,
      onPreActivityStreamFailure: () => continuationRateLimitRegistry.recordStreamFallback(context),
    }),
  );
  llmRoutes.post('/llm/commit-telemetry', createCommitTelemetryHandler(telemetry));

  return llmRoutes;
}

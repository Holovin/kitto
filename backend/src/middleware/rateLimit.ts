import type { Context, Next } from 'hono';

const DEFAULT_RATE_LIMIT_CLEANUP_INTERVAL_REQUESTS = 100;

interface RateLimitOptions {
  onRejected?: (context: Context, details: { key: string; retryAfterSeconds: number }) => Promise<void> | void;
  maxEntries?: number;
  maxRequests: number;
  shouldCount?: (context: Context) => Promise<boolean> | boolean;
  windowMs: number;
  cleanupIntervalRequests?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function pruneExpiredRateLimitEntries(entries: Map<string, RateLimitEntry>, now: number) {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) {
      entries.delete(key);
    }
  }
}

export function trimRateLimitEntries(
  entries: Map<string, RateLimitEntry>,
  {
    maxEntries,
    now,
    protectedKey,
  }: {
    maxEntries: number;
    now: number;
    protectedKey?: string;
  },
) {
  pruneExpiredRateLimitEntries(entries, now);

  if (entries.size <= maxEntries) {
    return;
  }

  for (const key of entries.keys()) {
    if (key === protectedKey) {
      continue;
    }

    entries.delete(key);

    if (entries.size <= maxEntries) {
      return;
    }
  }
}

export function shouldCleanupRateLimitEntries({
  cleanupIntervalRequests,
  maxEntries,
  requestCount,
  size,
}: {
  cleanupIntervalRequests: number;
  maxEntries: number;
  requestCount: number;
  size: number;
}) {
  return requestCount >= cleanupIntervalRequests || size > maxEntries;
}

function getRateLimitKey(context: Context) {
  const forwardedFor = context.req.header('x-forwarded-for');
  const realIp = context.req.header('x-real-ip');

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'local';
  }

  return realIp?.trim() || 'local';
}

export function createInMemoryRateLimitMiddleware({
  maxEntries = Number.POSITIVE_INFINITY,
  maxRequests,
  windowMs,
  cleanupIntervalRequests = DEFAULT_RATE_LIMIT_CLEANUP_INTERVAL_REQUESTS,
  onRejected,
  shouldCount,
}: RateLimitOptions) {
  const entries = new Map<string, RateLimitEntry>();
  const cleanupInterval = Math.max(1, cleanupIntervalRequests);
  let requestsSinceCleanup = 0;

  return async function rateLimitMiddleware(context: Context, next: Next) {
    if ((await shouldCount?.(context)) === false) {
      await next();
      return;
    }

    const now = Date.now();
    const key = getRateLimitKey(context);
    requestsSinceCleanup += 1;

    if (
      shouldCleanupRateLimitEntries({
        cleanupIntervalRequests: cleanupInterval,
        maxEntries,
        requestCount: requestsSinceCleanup,
        size: entries.size,
      })
    ) {
      trimRateLimitEntries(entries, { maxEntries, now, protectedKey: key });
      requestsSinceCleanup = 0;
    }

    const existingEntry = entries.get(key);

    if (!existingEntry || existingEntry.resetAt <= now) {
      if (existingEntry) {
        entries.delete(key);
      }

      entries.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      if (entries.size > maxEntries) {
        trimRateLimitEntries(entries, { maxEntries, now, protectedKey: key });
      }

      await next();
      return;
    }

    if (existingEntry.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existingEntry.resetAt - now) / 1000));

      context.header('Retry-After', String(retryAfterSeconds));
      await onRejected?.(context, { key, retryAfterSeconds });
      return context.json(
        {
          error: 'Too many LLM requests. Please wait a moment and try again.',
        },
        429,
      );
    }

    existingEntry.count += 1;
    await next();
  };
}

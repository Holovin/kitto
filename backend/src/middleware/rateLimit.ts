import type { Context, Next } from 'hono';

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
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

function getRateLimitKey(context: Context) {
  const forwardedFor = context.req.header('x-forwarded-for');
  const realIp = context.req.header('x-real-ip');

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'local';
  }

  return realIp?.trim() || 'local';
}

export function createInMemoryRateLimitMiddleware({ maxRequests, windowMs }: RateLimitOptions) {
  const entries = new Map<string, RateLimitEntry>();

  return async function rateLimitMiddleware(context: Context, next: Next) {
    const now = Date.now();
    pruneExpiredRateLimitEntries(entries, now);
    const key = getRateLimitKey(context);
    const existingEntry = entries.get(key);

    if (!existingEntry || existingEntry.resetAt <= now) {
      entries.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      await next();
      return;
    }

    if (existingEntry.count >= maxRequests) {
      context.header('Retry-After', String(Math.max(1, Math.ceil((existingEntry.resetAt - now) / 1000))));
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

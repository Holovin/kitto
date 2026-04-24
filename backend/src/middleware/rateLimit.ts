import type { Context, Next } from 'hono';

interface RateLimitOptions {
  onRejected?: (context: Context, details: { retryAfterSeconds: number }) => Promise<void> | void;
  maxRequests: number;
  shouldCount?: (context: Context) => Promise<boolean> | boolean;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimitMiddleware({
  maxRequests,
  windowMs,
  onRejected,
  shouldCount,
}: RateLimitOptions) {
  let entry: RateLimitEntry | null = null;

  return async function rateLimitMiddleware(context: Context, next: Next) {
    if ((await shouldCount?.(context)) === false) {
      await next();
      return;
    }

    const now = Date.now();

    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };

      await next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

      context.header('Retry-After', String(retryAfterSeconds));
      await onRejected?.(context, { retryAfterSeconds });
      return context.json(
        {
          error: 'Too many LLM requests. Please wait a moment and try again.',
        },
        429,
      );
    }

    entry.count += 1;
    await next();
  };
}

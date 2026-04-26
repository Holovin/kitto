import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { createInMemoryRateLimitMiddleware } from '#backend/middleware/rateLimit.js';

function createRateLimitedApp(options: {
  maxRequests: number;
  shouldCount?: (context: Context) => boolean;
  windowMs: number;
}) {
  const app = new Hono();

  app.use('*', createInMemoryRateLimitMiddleware(options));
  app.get('/limited', (context) => context.json({ ok: true }));

  return app;
}

describe('rate limit middleware', () => {
  it('blocks requests after the configured threshold', async () => {
    const app = createRateLimitedApp({
      maxRequests: 1,
      windowMs: 60_000,
    });

    const firstResponse = await app.request('/limited');
    const secondResponse = await app.request('/limited');

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get('retry-after')).toBe('60');
    expect(await secondResponse.json()).toEqual({
      error: 'Too many LLM requests. Please wait a moment and try again.',
    });
  });

  it('ignores spoofed forwarding headers when keying requests', async () => {
    const app = createRateLimitedApp({
      maxRequests: 1,
      windowMs: 60_000,
    });

    const firstResponse = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.10',
      },
    });
    const secondResponse = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.11',
        'x-real-ip': '198.51.100.12',
      },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
  });

  it('can skip counting requests that the caller marks as exempt', async () => {
    const app = createRateLimitedApp({
      maxRequests: 1,
      shouldCount: (context) => context.req.header('x-skip-rate-limit') !== '1',
      windowMs: 60_000,
    });

    const skippedResponse = await app.request('/limited', {
      headers: {
        'x-skip-rate-limit': '1',
      },
    });
    const firstCountedResponse = await app.request('/limited');
    const secondCountedResponse = await app.request('/limited');

    expect(skippedResponse.status).toBe(200);
    expect(firstCountedResponse.status).toBe(200);
    expect(secondCountedResponse.status).toBe(429);
  });

  it('does not create separate buckets from spoofed forwarding headers', async () => {
    const app = createRateLimitedApp({
      maxRequests: 3,
      windowMs: 60_000,
    });

    const firstClient = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.10',
      },
    });
    const secondClient = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.11',
      },
    });
    const thirdClient = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.12',
      },
    });
    const secondClientRetry = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.11',
      },
    });
    const firstClientRetry = await app.request('/limited', {
      headers: {
        'x-forwarded-for': '198.51.100.10',
      },
    });

    expect(firstClient.status).toBe(200);
    expect(secondClient.status).toBe(200);
    expect(thirdClient.status).toBe(200);
    expect(secondClientRetry.status).toBe(429);
    expect(firstClientRetry.status).toBe(429);
  });
});

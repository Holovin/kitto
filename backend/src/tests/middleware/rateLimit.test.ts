import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createInMemoryRateLimitMiddleware, pruneExpiredRateLimitEntries } from '../../middleware/rateLimit.js';

function createRateLimitedApp(options: { maxRequests: number; windowMs: number }) {
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

  it('uses X-Forwarded-For to distinguish different clients', async () => {
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
      },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
  });

  it('cleans expired rate-limit entries before handling the next request', () => {
    const entries = new Map([
      [
        'expired',
        {
          count: 1,
          resetAt: 100,
        },
      ],
      [
        'active',
        {
          count: 2,
          resetAt: 500,
        },
      ],
    ]);

    pruneExpiredRateLimitEntries(entries, 200);

    expect(entries).toEqual(
      new Map([
        [
          'active',
          {
            count: 2,
            resetAt: 500,
          },
        ],
      ]),
    );
  });
});

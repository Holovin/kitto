import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  createInMemoryRateLimitMiddleware,
  pruneExpiredRateLimitEntries,
  shouldCleanupRateLimitEntries,
  trimRateLimitEntries,
} from '../../middleware/rateLimit.js';

function createRateLimitedApp(options: {
  cleanupIntervalRequests?: number;
  maxEntries?: number;
  maxRequests: number;
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

  it('schedules cleanup after the configured number of requests', () => {
    expect(
      shouldCleanupRateLimitEntries({
        cleanupIntervalRequests: 3,
        maxEntries: 10,
        requestCount: 3,
        size: 2,
      }),
    ).toBe(true);
    expect(
      shouldCleanupRateLimitEntries({
        cleanupIntervalRequests: 3,
        maxEntries: 10,
        requestCount: 2,
        size: 2,
      }),
    ).toBe(false);
  });

  it('schedules cleanup when the tracked client map exceeds the configured cap', () => {
    expect(
      shouldCleanupRateLimitEntries({
        cleanupIntervalRequests: 100,
        maxEntries: 2,
        requestCount: 1,
        size: 3,
      }),
    ).toBe(true);
  });

  it('evicts the oldest non-expired entries when the map exceeds the configured cap', () => {
    const entries = new Map([
      [
        '198.51.100.10',
        {
          count: 1,
          resetAt: 500,
        },
      ],
      [
        '198.51.100.11',
        {
          count: 1,
          resetAt: 600,
        },
      ],
      [
        '198.51.100.12',
        {
          count: 1,
          resetAt: 700,
        },
      ],
    ]);

    trimRateLimitEntries(entries, {
      maxEntries: 2,
      now: 200,
    });

    expect([...entries.keys()]).toEqual(['198.51.100.11', '198.51.100.12']);
  });

  it('preserves the active requester when trimming overflow entries', () => {
    const entries = new Map([
      [
        '198.51.100.10',
        {
          count: 1,
          resetAt: 500,
        },
      ],
      [
        '198.51.100.11',
        {
          count: 1,
          resetAt: 600,
        },
      ],
      [
        '198.51.100.12',
        {
          count: 1,
          resetAt: 700,
        },
      ],
    ]);

    trimRateLimitEntries(entries, {
      maxEntries: 2,
      now: 200,
      protectedKey: '198.51.100.10',
    });

    expect([...entries.keys()]).toEqual(['198.51.100.10', '198.51.100.12']);
  });

  it('drops the oldest tracked client once the middleware entry cap is exceeded', async () => {
    const app = createRateLimitedApp({
      cleanupIntervalRequests: 100,
      maxEntries: 2,
      maxRequests: 1,
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
    expect(firstClientRetry.status).toBe(200);
  });
});

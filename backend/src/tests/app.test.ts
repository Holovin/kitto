import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '#backend/app.js';
import { createTestEnv } from './createTestEnv.js';

describe('createApp', () => {
  it.each(['/health', '/config', '/llm', '/llm/generate', '/llm/generate/stream'])(
    'returns JSON 404 for unsupported root route %s',
    async (routePath) => {
      const app = createApp(createTestEnv());

      const response = await app.request(routePath);

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({
        error: 'Route not found.',
      });
    },
  );

  it('serves runtime config from /api/config with API CORS headers', async () => {
    const env = createTestEnv({
      FRONTEND_ORIGIN: 'https://builder.kitto.test',
      LLM_CHAT_HISTORY_MAX_ITEMS: 7,
      LLM_MAX_REPAIR_ATTEMPTS: 2,
      LLM_REQUEST_MAX_BYTES: 654,
      LLM_USER_PROMPT_MAX_CHARS: 321,
    });
    const app = createApp(env);

    const response = await app.request('/api/config', {
      headers: {
        Origin: 'https://builder.kitto.test',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://builder.kitto.test');
    expect(await response.json()).toEqual({
      generation: {
        repairTemperature: 0.2,
        temperature: 0.4,
      },
      limits: {
        chatHistoryMaxItems: 7,
        promptMaxChars: 321,
        requestMaxBytes: 654,
      },
      repair: {
        maxRepairAttempts: 2,
        maxValidationIssues: 20,
      },
      timeouts: {
        streamIdleTimeoutMs: 45000,
        streamMaxDurationMs: 120000,
      },
    });
  });

  it('serves model health from /api/health without leaking secrets', async () => {
    const app = createApp(
      createTestEnv({
        OPENAI_API_KEY: '',
        OPENAI_MODEL: 'gpt-test-model',
      }),
    );

    const response = await app.request('/api/health');
    const payload = (await response.json()) as {
      model: string;
      openaiConfigured: boolean;
      status: string;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe('ok');
    expect(payload.model).toBe('gpt-test-model');
    expect(payload.openaiConfigured).toBe(false);
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it('returns the JSON 404 contract for unknown API routes', async () => {
    const app = createApp(createTestEnv());

    const response = await app.request('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: 'Route not found.',
    });
  });

  it('serves index.html for frontend routes when a production build exists', async () => {
    const frontendDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitto-openui-dist-'));

    try {
      fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<!doctype html><html><body><div id="root">Kitto</div></body></html>');

      const app = createApp(
        createTestEnv({
          frontendDistDir,
        }),
      );

      const response = await app.request('/chat');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('<div id="root">Kitto</div>');
    } finally {
      fs.rmSync(frontendDistDir, { force: true, recursive: true });
    }
  });

  it('serves root-level static files from frontend/dist when they exist', async () => {
    const frontendDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitto-openui-dist-'));

    try {
      fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<!doctype html><html><body><div id="root">Kitto</div></body></html>');
      fs.writeFileSync(path.join(frontendDistDir, 'robots.txt'), 'User-agent: *');

      const app = createApp(
        createTestEnv({
          frontendDistDir,
        }),
      );

      const response = await app.request('/robots.txt');

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('User-agent: *');
    } finally {
      fs.rmSync(frontendDistDir, { force: true, recursive: true });
    }
  });
});

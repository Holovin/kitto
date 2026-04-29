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
      frontendOrigin: 'https://builder.kitto.test',
      maxRepairAttempts: 2,
      modelPromptMaxChars: 987,
      requestMaxBytes: 654,
      userPromptMaxChars: 321,
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
        chatMessageMaxChars: 321,
        chatHistoryMaxItems: 5,
        promptMaxChars: 321,
        requestMaxBytes: 654,
        sourceMaxChars: 80_000,
      },
      repair: {
        maxRepairAttempts: 2,
        maxValidationIssues: 20,
      },
      timeouts: {
        streamIdleTimeoutMs: 60000,
        streamMaxDurationMs: 180000,
      },
    });
  });

  it('exposes the hard current source maximum independently from the model prompt budget', async () => {
    const app = createApp(
      createTestEnv({
        currentSourceEmergencyMaxChars: 30_000,
        modelPromptMaxChars: 20_000,
      }),
    );

    const response = await app.request('/api/config');
    const payload = (await response.json()) as { limits: { sourceMaxChars: number } };

    expect(response.status).toBe(200);
    expect(payload.limits.sourceMaxChars).toBe(30_000);
  });

  it('serves model health from /api/health without leaking secrets', async () => {
    const app = createApp(
      createTestEnv({
        openAiApiKey: '',
        openAiModel: 'gpt-test-model',
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

  it('returns 404 instead of 500 for malformed encoded asset paths', async () => {
    const frontendDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitto-openui-dist-'));

    try {
      fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<!doctype html><html><body><div id="root">Kitto</div></body></html>');

      const app = createApp(
        createTestEnv({
          frontendDistDir,
        }),
      );

      const response = await app.request('/assets/%E0%A4%A');

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({
        error: 'Route not found.',
      });
    } finally {
      fs.rmSync(frontendDistDir, { force: true, recursive: true });
    }
  });
});

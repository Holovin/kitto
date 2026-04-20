import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { frontendRoutes } from '../frontendRoutes.js';
import { createTestEnv } from './createTestEnv.js';

const frontendIndexHtml = '<!doctype html><html><body><div id="root">Kitto</div></body></html>';

function createProductionApp() {
  const frontendDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitto-openui-routes-'));
  fs.writeFileSync(path.join(frontendDistDir, 'index.html'), frontendIndexHtml);

  return {
    app: createApp(
      createTestEnv({
        frontendDistDir,
      }),
    ),
    frontendDistDir,
  };
}

function expectJsonNotFound(payload: unknown) {
  expect(payload).toEqual({
    error: 'Route not found.',
  });
}

describe('frontend route fallback contract', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each(frontendRoutes)('serves index.html for %s when frontend/dist/index.html exists', async (routePath) => {
    const { app, frontendDistDir } = createProductionApp();
    tempDirectories.push(frontendDistDir);

    const response = await app.request(routePath);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root">Kitto</div>');
  });

  it.each(['/missing', '/api/missing', '/health', '/llm/generate'])(
    'returns JSON 404 instead of index.html for %s when production fallback is enabled',
    async (routePath) => {
      const { app, frontendDistDir } = createProductionApp();
      tempDirectories.push(frontendDistDir);

      const response = await app.request(routePath);

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expectJsonNotFound(await response.json());
    },
  );
});

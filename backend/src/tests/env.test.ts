import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readIntEnv, resolveBackendEnvPath, resolveFrontendDistDir } from '#backend/env.js';

describe('env path resolution', () => {
  const workspaceRoot = path.join(path.sep, 'workspace');

  it.each([
    ['src', path.join(workspaceRoot, 'backend', 'src', 'env.ts')],
    ['dist', path.join(workspaceRoot, 'backend', 'dist', 'env.js')],
  ])('resolves backend/.env from %s module paths', (_label, modulePath) => {
    const moduleUrl = pathToFileURL(modulePath);

    expect(resolveBackendEnvPath(moduleUrl)).toBe(path.join(workspaceRoot, 'backend', '.env'));
  });

  it.each([
    ['src', path.join(workspaceRoot, 'backend', 'src', 'env.ts')],
    ['dist', path.join(workspaceRoot, 'backend', 'dist', 'env.js')],
  ])('resolves frontend/dist from %s module paths', (_label, modulePath) => {
    const moduleUrl = pathToFileURL(modulePath);

    expect(resolveFrontendDistDir(moduleUrl)).toBe(path.join(workspaceRoot, 'frontend', 'dist'));
  });
});

describe('readIntEnv', () => {
  afterEach(() => {
    delete process.env.KITTO_TEST_INT;
  });

  it('uses the fallback when the variable is unset', () => {
    expect(readIntEnv('KITTO_TEST_INT', 42, { min: 1 })).toBe(42);
  });

  it('parses integer values inside the configured range', () => {
    process.env.KITTO_TEST_INT = '1200000';

    expect(readIntEnv('KITTO_TEST_INT', 42, { min: 1, max: 2_000_000 })).toBe(1_200_000);
  });

  it('fails fast for invalid integer values', () => {
    process.env.KITTO_TEST_INT = '12.5';

    expect(() => readIntEnv('KITTO_TEST_INT', 42, { min: 1 })).toThrow('KITTO_TEST_INT must be an integer.');
  });

  it('fails fast for out-of-range values', () => {
    process.env.KITTO_TEST_INT = '0';

    expect(() => readIntEnv('KITTO_TEST_INT', 42, { min: 1 })).toThrow(
      'KITTO_TEST_INT must be greater than or equal to 1.',
    );
  });
});

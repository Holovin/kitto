import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveBackendEnvPath, resolveFrontendDistDir } from '../env.js';

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

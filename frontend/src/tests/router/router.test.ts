/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const routerSourcePath = path.resolve(currentDirectory, '../../router/router.tsx');

function readRouterSource() {
  return fs.readFileSync(routerSourcePath, 'utf8');
}

describe('router source', () => {
  it('defines a hydrate fallback element for the root route', () => {
    const source = readRouterSource();

    expect(source).toContain('const hydrateFallbackElement = <div />;');
    expect(source).toMatch(/errorElement:\s*<RouteErrorBoundary\s*\/>,\s*[\s\S]*?hydrateFallbackElement,/);
  });
});

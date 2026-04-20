/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SiteRoutes } from '@router/siteRoutes';

type FrontendRoutesManifest = {
  routes: string[];
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendRoutesManifestPath = path.resolve(currentDirectory, '../../../../shared/frontend-routes.json');

function readFrontendRoutesManifest(): FrontendRoutesManifest {
  return JSON.parse(fs.readFileSync(frontendRoutesManifestPath, 'utf8')) as FrontendRoutesManifest;
}

describe('SiteRoutes', () => {
  it('matches the shared frontend route manifest', () => {
    const manifest = readFrontendRoutesManifest();
    const siteRoutes = Object.values(SiteRoutes).map(({ path: routePath }) => routePath);

    expect(siteRoutes).toEqual(manifest.routes);
  });
});

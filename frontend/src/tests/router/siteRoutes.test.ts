import { describe, expect, it } from 'vitest';
import frontendRoutesManifest from '@kitto-openui/shared/frontend-routes.json' with { type: 'json' };
import { SiteRoutes } from '@router/siteRoutes';

type FrontendRoutesManifest = {
  routes: string[];
};

function readFrontendRoutesManifest(): FrontendRoutesManifest {
  return frontendRoutesManifest as FrontendRoutesManifest;
}

describe('SiteRoutes', () => {
  it('matches the shared frontend route manifest', () => {
    const manifest = readFrontendRoutesManifest();
    const siteRoutes = Object.values(SiteRoutes).map(({ path: routePath }) => routePath);

    expect(siteRoutes).toEqual(manifest.routes);
  });
});

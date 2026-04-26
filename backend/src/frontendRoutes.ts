import fs from 'node:fs';
import { z } from 'zod';

const frontendRoutesManifestSchema = z.object({
  routes: z
    .array(z.string().min(1).startsWith('/'))
    .nonempty()
    .superRefine((routes, context) => {
      const normalizedRoutes = routes.map(normalizeRoutePath);
      const duplicateRoutes = normalizedRoutes.filter((route, index) => normalizedRoutes.indexOf(route) !== index);

      for (const duplicateRoute of new Set(duplicateRoutes)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate frontend route: ${duplicateRoute}`,
        });
      }
    }),
});

const frontendRoutesManifestUrl = new URL(import.meta.resolve('@kitto-openui/shared/frontend-routes.json'));

function normalizeRoutePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function loadFrontendRoutes() {
  const manifest = JSON.parse(fs.readFileSync(frontendRoutesManifestUrl, 'utf8'));

  return frontendRoutesManifestSchema.parse(manifest).routes.map(normalizeRoutePath);
}

export const frontendRoutes = Object.freeze(loadFrontendRoutes());

const frontendRouteSet = new Set(frontendRoutes);

export function isFrontendRoute(pathname: string) {
  return frontendRouteSet.has(normalizeRoutePath(pathname));
}

import { readPath } from './path';

export const CURRENT_SCREEN_PATH = 'navigation.currentScreenId';

export function normalizeCurrentScreenId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue ? normalizedValue : null;
}

export function getCurrentScreenId(domainData?: Record<string, unknown>): string | null {
  return normalizeCurrentScreenId(readPath(domainData ?? {}, CURRENT_SCREEN_PATH));
}

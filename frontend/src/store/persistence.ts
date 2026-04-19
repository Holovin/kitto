import { normalizeBuilderState } from '@features/builder/store/builderSlice';
import { normalizeBuilderSessionState } from '@features/builder/store/builderSessionSlice';
import { normalizeDomainState } from '@features/builder/store/domainSlice';

export const REMEMBER_PREFIX = '@@remember-';
export const REMEMBER_KEYS = ['builder', 'builderSession', 'domain'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function migrateRememberedState(state: unknown) {
  const persistedState = isRecord(state) ? state : {};
  const builder = normalizeBuilderState(persistedState.builder);
  const latestSnapshot = builder.history.at(-1);

  return {
    ...persistedState,
    builder,
    builderSession: normalizeBuilderSessionState(persistedState.builderSession, latestSnapshot?.runtimeState ?? {}),
    domain: normalizeDomainState(persistedState.domain, latestSnapshot?.domainData ?? {}),
  };
}

import {
  normalizeBuilderSessionState,
  validateRestoredBuilderSessionResult,
} from '@features/builder/store/builderSessionSlice';
import { normalizeDomainState, validateRestoredDomainResult } from '@features/builder/store/domainSlice';
import { logRecoveryEvent } from './recoveryEvents';

export const REMEMBER_PREFIX = '@@remember-';
export const REMEMBER_KEYS = ['builder', 'builderSession', 'domain'] as const;

type RememberKey = (typeof REMEMBER_KEYS)[number];
type RecoverableRememberKey = Exclude<RememberKey, 'builder'>;

function isRememberKey(key: string): key is RememberKey {
  return REMEMBER_KEYS.some((rememberKey) => rememberKey === key);
}

function logDroppedRememberedSlice(slice: RecoverableRememberKey, reason: string) {
  logRecoveryEvent({
    kind: 'persistence/dropped',
    reason,
    slice,
  });
}

function getInitialRememberedSliceState(slice: RecoverableRememberKey) {
  return slice === 'builderSession' ? normalizeBuilderSessionState(undefined) : normalizeDomainState(undefined);
}

function clearAllRememberedState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  window.localStorage.clear();
}

export function unserializeRememberedState(data: string, key: string) {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(data);
  } catch (error) {
    if (key === 'builder') {
      clearAllRememberedState();
      return undefined;
    }

    if (key === 'builderSession' || key === 'domain') {
      logDroppedRememberedSlice(key, error instanceof Error ? error.message : 'Persisted state was not valid JSON.');
      return getInitialRememberedSliceState(key);
    }

    throw error;
  }

  if (!isRememberKey(key) || key === 'builder') {
    return parsedValue;
  }

  const validationResult =
    key === 'builderSession'
      ? validateRestoredBuilderSessionResult(parsedValue)
      : validateRestoredDomainResult(parsedValue);

  if (validationResult.state) {
    return validationResult.state;
  }

  logDroppedRememberedSlice(key, validationResult.reason ?? 'Persisted state had an invalid shape.');
  return getInitialRememberedSliceState(key);
}

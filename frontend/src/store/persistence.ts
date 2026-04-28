import { normalizeBuilderState } from '@pages/Chat/builder/store/builderSlice';
import { normalizeBuilderSessionState, validateRestoredBuilderSessionResult } from '@pages/Chat/builder/store/builderSessionSlice';
import { normalizeDomainState, validateRestoredDomainResult } from '@pages/Chat/builder/store/domainSlice';
import { logRecoveryEvent } from './recoveryEvents';

export const REMEMBER_PREFIX = '@@remember-';
export const REMEMBER_KEYS = ['builder', 'builderSession', 'domain'] as const;
export const BUILDER_PERSISTENCE_QUOTA_WARNING =
  'Local storage is almost full. Kitto kept the current app but cleared saved undo history for persistence.';

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

const pendingRecoverableSliceReset = new Set<RecoverableRememberKey>();
let recoverableSliceResetCleanupScheduled = false;

function scheduleRecoverableSliceResetCleanup() {
  if (recoverableSliceResetCleanupScheduled) {
    return;
  }

  recoverableSliceResetCleanupScheduled = true;
  queueMicrotask(() => {
    pendingRecoverableSliceReset.clear();
    recoverableSliceResetCleanupScheduled = false;
  });
}

function markRecoverableSlicesForReset() {
  pendingRecoverableSliceReset.clear();

  for (const rememberKey of REMEMBER_KEYS) {
    if (rememberKey === 'builder') {
      continue;
    }

    pendingRecoverableSliceReset.add(rememberKey);
  }

  scheduleRecoverableSliceResetCleanup();
}

function consumeRecoverableSliceReset(slice: RecoverableRememberKey) {
  if (!pendingRecoverableSliceReset.has(slice)) {
    return false;
  }

  pendingRecoverableSliceReset.delete(slice);
  return true;
}

function clearPersistedRememberedState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  for (const rememberKey of REMEMBER_KEYS) {
    window.localStorage.removeItem(`${REMEMBER_PREFIX}${rememberKey}`);
  }
}

function isQuotaExceededError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014)
  );
}

function dispatchPersistenceQuotaWarning() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('kitto:persistence-warning', {
      detail: {
        message: BUILDER_PERSISTENCE_QUOTA_WARNING,
      },
    }),
  );
}

function createCurrentOnlyBuilderPersistencePayload(serializedBuilderState: string) {
  const parsedBuilderState = JSON.parse(serializedBuilderState) as unknown;
  const normalizedBuilderState = normalizeBuilderState(parsedBuilderState);
  const currentSnapshot = normalizedBuilderState.history.at(-1);

  return JSON.stringify({
    ...normalizedBuilderState,
    history: currentSnapshot ? [currentSnapshot] : [],
    previousChangeSummaries: [],
    redoHistory: [],
  });
}

export function createRememberStorage(storage: Storage): Storage {
  return {
    get length() {
      return storage.length;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.getItem(key);
    },
    key(index: number) {
      return storage.key(index);
    },
    removeItem(key: string) {
      storage.removeItem(key);
    },
    setItem(key: string, value: string) {
      try {
        storage.setItem(key, value);
        return;
      } catch (error) {
        if (!isQuotaExceededError(error) || key !== `${REMEMBER_PREFIX}builder`) {
          throw error;
        }
      }

      try {
        storage.setItem(key, createCurrentOnlyBuilderPersistencePayload(value));
        logRecoveryEvent({
          kind: 'persistence/quota-trimmed',
          reason: 'Persisted builder state exceeded localStorage quota.',
          slice: 'builder',
        });
        dispatchPersistenceQuotaWarning();
      } catch (fallbackError) {
        storage.removeItem(key);
        logRecoveryEvent({
          kind: 'persistence/dropped',
          reason: fallbackError instanceof Error ? fallbackError.message : 'Persisted builder state exceeded localStorage quota.',
          slice: 'builder',
        });
        dispatchPersistenceQuotaWarning();
      }
    },
  };
}

export function unserializeRememberedState(data: string, key: string) {
  if ((key === 'builderSession' || key === 'domain') && consumeRecoverableSliceReset(key)) {
    return getInitialRememberedSliceState(key);
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(data);
  } catch (error) {
    if (key === 'builder') {
      clearPersistedRememberedState();
      markRecoverableSlicesForReset();
      return normalizeBuilderState(undefined);
    }

    if (key === 'builderSession' || key === 'domain') {
      logDroppedRememberedSlice(key, error instanceof Error ? error.message : 'Persisted state was not valid JSON.');
      return getInitialRememberedSliceState(key);
    }

    throw error;
  }

  if (!isRememberKey(key)) {
    return parsedValue;
  }

  if (key === 'builder') {
    return normalizeBuilderState(parsedValue);
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

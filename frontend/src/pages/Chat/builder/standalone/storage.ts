import {
  createStandaloneStoredState,
  normalizeStandaloneDomainData,
  normalizeStandaloneRuntimeState,
  parseStandaloneStoredState,
  type StandaloneStoredState,
} from './types';

export type RestoredStandaloneState = {
  runtimeState: Record<string, unknown>;
  domainData: Record<string, unknown>;
  restoredFromStorage: boolean;
};

type StandaloneStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function getBestEffortLocalStorage(): StandaloneStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readStandaloneStoredState(
  storageKey: string,
  storage: StandaloneStorage | null = getBestEffortLocalStorage(),
): StandaloneStoredState | null {
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(storageKey);

    if (!rawValue) {
      return null;
    }

    return parseStandaloneStoredState(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function restoreStandaloneState(
  storageKey: string,
  initialRuntimeState: unknown,
  initialDomainData: Record<string, unknown>,
  storage: StandaloneStorage | null = getBestEffortLocalStorage(),
): RestoredStandaloneState {
  const fallbackRuntimeState = normalizeStandaloneRuntimeState(initialRuntimeState);
  const fallbackDomainData = normalizeStandaloneDomainData(initialDomainData);
  const storedState = readStandaloneStoredState(storageKey, storage);

  if (!storedState) {
    return {
      runtimeState: fallbackRuntimeState,
      domainData: fallbackDomainData,
      restoredFromStorage: false,
    };
  }

  return {
    runtimeState: normalizeStandaloneRuntimeState(storedState.runtimeState),
    domainData: normalizeStandaloneDomainData(storedState.domainData),
    restoredFromStorage: true,
  };
}

export function writeStandaloneStoredState(
  storageKey: string,
  runtimeState: unknown,
  domainData: Record<string, unknown>,
  storage: StandaloneStorage | null = getBestEffortLocalStorage(),
) {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(createStandaloneStoredState(runtimeState, domainData)));
    return true;
  } catch {
    return false;
  }
}

export function clearStandaloneStoredState(
  storageKey: string,
  storage: StandaloneStorage | null = getBestEffortLocalStorage(),
) {
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

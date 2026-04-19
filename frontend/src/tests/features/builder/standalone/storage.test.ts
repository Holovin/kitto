import { afterEach, describe, expect, it } from 'vitest';
import {
  clearStandaloneStoredState,
  readStandaloneStoredState,
  restoreStandaloneState,
  writeStandaloneStoredState,
} from '@features/builder/standalone/storage';

type MemoryStorage = {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
  values: Map<string, string>;
};

function createMemoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(seed));

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    values,
  };
}

const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

describe('standalone storage helpers', () => {
  afterEach(() => {
    if (previousLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorageDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('falls back to the embedded baseline state when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    const restoredState = restoreStandaloneState('kitto:standalone:test', { currentScreen: 'intro' }, { app: { answers: [] as string[] } });

    expect(restoredState).toEqual({
      runtimeState: { currentScreen: 'intro' },
      domainData: { app: { answers: [] } },
      restoredFromStorage: false,
    });
  });

  it('ignores corrupted saved state and uses the embedded baseline instead', () => {
    const storage = createMemoryStorage({
      'kitto:standalone:test': '{not-json',
    });

    const restoredState = restoreStandaloneState(
      'kitto:standalone:test',
      { currentScreen: 'intro' },
      { app: { answers: ['baseline'] } },
      storage,
    );

    expect(restoredState).toEqual({
      runtimeState: { currentScreen: 'intro' },
      domainData: { app: { answers: ['baseline'] } },
      restoredFromStorage: false,
    });
  });

  it('round-trips saved standalone state through storage helpers', () => {
    const storage = createMemoryStorage();

    expect(
      writeStandaloneStoredState(
        'kitto:standalone:test',
        { currentScreen: 'question', form: { answer: 'A' } },
        { app: { answers: ['A'] } },
        storage,
      ),
    ).toBe(true);

    expect(readStandaloneStoredState('kitto:standalone:test', storage)).toEqual({
      version: 1,
      runtimeState: { currentScreen: 'question', form: { answer: 'A' } },
      domainData: { app: { answers: ['A'] } },
      updatedAt: expect.any(String),
    });

    expect(clearStandaloneStoredState('kitto:standalone:test', storage)).toBe(true);
    expect(storage.values.size).toBe(0);
  });
});

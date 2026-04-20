import { afterEach, describe, expect, it } from 'vitest';
import { createDomainToolProvider } from '@features/builder/openui/runtime/createDomainToolProvider';
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

  it('persists append_item updates through standalone storage for offline exports', async () => {
    const storage = createMemoryStorage();
    const runtimeState = { currentScreen: 'main' };
    let domainData = restoreStandaloneState('kitto:standalone:test', runtimeState, { app: { tasks: [] as Array<Record<string, unknown>> } }, storage)
      .domainData;

    const standaloneToolProvider = createDomainToolProvider({
      readDomainData: () => domainData,
      replaceDomainData: (nextDomainData) => {
        domainData = structuredClone(nextDomainData);
        writeStandaloneStoredState('kitto:standalone:test', runtimeState, domainData, storage);
      },
    });

    const appendedTasks = (await standaloneToolProvider.append_item({
      path: 'app.tasks',
      value: { title: 'Offline task', completed: false },
    })) as Array<Record<string, unknown>>;

    expect(appendedTasks).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        title: 'Offline task',
        completed: false,
      }),
    ]);
    expect(readStandaloneStoredState('kitto:standalone:test', storage)).toMatchObject({
      domainData: {
        app: {
          tasks: [
            {
              id: appendedTasks[0]?.id,
              title: 'Offline task',
              completed: false,
            },
          ],
        },
      },
      runtimeState,
      version: 1,
    });

    const restoredState = restoreStandaloneState('kitto:standalone:test', runtimeState, { app: { tasks: [] as Array<Record<string, unknown>> } }, storage);

    expect(restoredState.restoredFromStorage).toBe(true);
    expect(restoredState.domainData).toEqual({
      app: {
        tasks: [
          {
            id: appendedTasks[0]?.id,
            title: 'Offline task',
            completed: false,
          },
        ],
      },
    });
  });
});

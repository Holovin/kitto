import { afterEach, describe, expect, it } from 'vitest';
import { createDomainToolProvider } from '@pages/Chat/builder/openui/runtime/createDomainToolProvider';
import {
  clearStandaloneStoredState,
  readStandaloneStoredState,
  restoreStandaloneState,
  writeStandaloneStoredState,
} from '@pages/Chat/builder/standalone/storage';
import { createStandaloneSnapshot, mergeStandaloneSnapshot, type StandaloneSnapshotUpdate } from '@src/standalone/snapshot';

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

function persistStandaloneSnapshot(
  storage: MemoryStorage,
  currentSnapshot: ReturnType<typeof createStandaloneSnapshot>,
  update: StandaloneSnapshotUpdate,
) {
  const nextSnapshot = mergeStandaloneSnapshot(currentSnapshot, update);

  writeStandaloneStoredState('kitto:standalone:test', nextSnapshot.runtimeState, nextSnapshot.domainData, storage);
  return nextSnapshot;
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

  it('restores the latest snapshot after runtime-only standalone updates', () => {
    const storage = createMemoryStorage();
    const initialRuntimeState = { currentScreen: 'intro' };
    const initialDomainData = { app: { answers: [] as string[] } };
    const nextRuntimeState = { currentScreen: 'summary', form: { answer: 'A' } };
    const nextSnapshot = persistStandaloneSnapshot(
      storage,
      createStandaloneSnapshot(initialRuntimeState, initialDomainData),
      { runtimeState: nextRuntimeState },
    );

    expect(readStandaloneStoredState('kitto:standalone:test', storage)).toMatchObject({
      runtimeState: nextRuntimeState,
      domainData: initialDomainData,
      version: 1,
    });
    expect(restoreStandaloneState('kitto:standalone:test', initialRuntimeState, initialDomainData, storage)).toEqual({
      runtimeState: nextSnapshot.runtimeState,
      domainData: nextSnapshot.domainData,
      restoredFromStorage: true,
    });
  });

  it('restores the latest snapshot after domain-only standalone updates', () => {
    const storage = createMemoryStorage();
    const initialRuntimeState = { currentScreen: 'intro' };
    const initialDomainData = { app: { answers: [] as string[] } };
    const nextDomainData = { app: { answers: ['A'] } };
    const nextSnapshot = persistStandaloneSnapshot(
      storage,
      createStandaloneSnapshot(initialRuntimeState, initialDomainData),
      { domainData: nextDomainData },
    );

    expect(readStandaloneStoredState('kitto:standalone:test', storage)).toMatchObject({
      runtimeState: initialRuntimeState,
      domainData: nextDomainData,
      version: 1,
    });
    expect(restoreStandaloneState('kitto:standalone:test', initialRuntimeState, initialDomainData, storage)).toEqual({
      runtimeState: nextSnapshot.runtimeState,
      domainData: nextSnapshot.domainData,
      restoredFromStorage: true,
    });
  });

  it('restores one consistent snapshot after sequential domain and runtime updates', () => {
    const storage = createMemoryStorage();
    const initialRuntimeState = { currentScreen: 'question' };
    const initialDomainData = { app: { answers: [] as string[] } };
    const nextDomainData = { app: { answers: ['A'] } };
    const nextRuntimeState = { currentScreen: 'summary' };

    const snapshotAfterDomainUpdate = persistStandaloneSnapshot(
      storage,
      createStandaloneSnapshot(initialRuntimeState, initialDomainData),
      { domainData: nextDomainData },
    );
    const snapshotAfterRuntimeUpdate = persistStandaloneSnapshot(storage, snapshotAfterDomainUpdate, {
      runtimeState: nextRuntimeState,
    });

    expect(readStandaloneStoredState('kitto:standalone:test', storage)).toMatchObject({
      runtimeState: nextRuntimeState,
      domainData: nextDomainData,
      version: 1,
    });
    expect(restoreStandaloneState('kitto:standalone:test', initialRuntimeState, initialDomainData, storage)).toEqual({
      runtimeState: snapshotAfterRuntimeUpdate.runtimeState,
      domainData: snapshotAfterRuntimeUpdate.domainData,
      restoredFromStorage: true,
    });
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

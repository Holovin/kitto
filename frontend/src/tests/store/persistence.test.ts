import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuilderSnapshot } from '@pages/Chat/builder/openui/runtime/persistedState';
import { normalizeBuilderState } from '@pages/Chat/builder/store/builderSlice';
import {
  BUILDER_PERSISTENCE_QUOTA_WARNING,
  createRememberStorage,
  REMEMBER_KEYS,
  REMEMBER_PREFIX,
  unserializeRememberedState,
} from '@store/persistence';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

describe('store persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        clear: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('restores runtimeSessionState from the current persisted builderSession shape', () => {
    const liveRuntimeState = {
      currentScreen: 'details',
      selectedPlan: 'pro',
    };

    expect(unserializeRememberedState(JSON.stringify({ runtimeSessionState: liveRuntimeState }), 'builderSession')).toEqual({
      runtimeSessionState: liveRuntimeState,
    });
  });

  it('restores builderSession runtimeSessionState keys that use OpenUI runtime variable names without recovery warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const liveRuntimeState = {
      $currentScreen: 'details',
      $draft: {
        title: 'Ada',
      },
      $lastChoice: 'pro',
    };

    expect(unserializeRememberedState(JSON.stringify({ runtimeSessionState: liveRuntimeState }), 'builderSession')).toEqual({
      runtimeSessionState: liveRuntimeState,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('restores domain.data from the current persisted domain shape', () => {
    const liveDomainData = {
      app: {
        submissions: [{ answer: 'Ada' }],
      },
    };

    expect(unserializeRememberedState(JSON.stringify({ data: liveDomainData }), 'domain')).toEqual({
      data: liveDomainData,
    });
  });

  it('normalizes persisted builder state before rehydrating it', () => {
    const snapshot = createBuilderSnapshot(validSource, { $currentScreen: 'main' }, { app: { tasks: [] as string[] } }, {
      appMemory: {
        version: 1,
        appSummary: 'Persisted app memory.',
        userPreferences: ['Keep persisted memory.'],
        avoid: [],
      },
      changeSummary: 'Restored persisted source.',
      summary: 'Restores persisted source.',
    });

    const restored = unserializeRememberedState(
      JSON.stringify({
        chatMessages: [
          {
            id: 'assistant-summary',
            role: 'assistant',
            content: 'Applied the latest chat instruction to the app definition.',
            excludeFromLlmContext: true,
            tone: 'success',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
          {
            id: 'invalid-role',
            role: 'observer',
            content: 'Should not survive rehydrate.',
          },
        ],
        committedSource: validSource,
        currentRequestId: 'builder-request-123',
        definitionWarnings: [{ code: 'warning', message: 'Keep me.' }, { code: 42 }],
        history: [snapshot],
        lastStreamChunkAt: 123456789,
        parseIssues: [{ code: 'persisted-issue', message: 'Should not stay live.' }],
        redoHistory: [{ ...snapshot, source: 'not valid openui' }],
        retryPrompt: 'Retry me.',
        streamError: 'This should be dropped.',
        streamedSource: `root = AppShell([
  Screen("secondary", "Secondary", [])
])`,
      }),
      'builder',
    ) as ReturnType<typeof normalizeBuilderState>;

    expect(restored).toEqual(
      expect.objectContaining({
        appMemory: {
          version: 1,
          appSummary: 'Persisted app memory.',
          userPreferences: ['Keep persisted memory.'],
          avoid: [],
        },
        committedSource: validSource,
        currentRequestId: null,
        definitionWarnings: [{ code: 'warning', message: 'Keep me.' }],
        lastStreamChunkAt: null,
        parseIssues: [],
        redoHistory: [],
        retryPrompt: null,
        streamError: null,
        streamedSource: validSource,
      }),
    );
    expect(restored.chatMessages).toEqual([
      expect.objectContaining({
        id: 'assistant-summary',
        role: 'assistant',
        content: 'Applied the latest chat instruction to the app definition.',
        excludeFromLlmContext: true,
      }),
    ]);
  });

  it('trims builder history when localStorage quota is exceeded', () => {
    let shouldThrowQuota = true;
    const storageData = new Map<string, string>();
    const setItemSpy = vi.fn((key: string, value: string) => {
      if (shouldThrowQuota && key === `${REMEMBER_PREFIX}builder`) {
        shouldThrowQuota = false;
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }

      storageData.set(key, value);
    });
    const dispatchEventSpy = vi.fn();
    const storage = createRememberStorage({
      get length() {
        return storageData.size;
      },
      clear: vi.fn(() => storageData.clear()),
      getItem: vi.fn((key: string) => storageData.get(key) ?? null),
      key: vi.fn((index: number) => [...storageData.keys()][index] ?? null),
      removeItem: vi.fn((key: string) => storageData.delete(key)),
      setItem: setItemSpy,
    });

    vi.stubGlobal('window', {
      ...window,
      dispatchEvent: dispatchEventSpy,
    });
    const firstSnapshot = createBuilderSnapshot('root = AppShell([])', {}, {});
    const currentSnapshot = createBuilderSnapshot(validSource, {}, {}, {
      appMemory: {
        version: 1,
        appSummary: 'Current memory.',
        userPreferences: [],
        avoid: [],
      },
      changeSummary: 'Current change.',
      summary: 'Current app.',
    });

    storage.setItem(
      `${REMEMBER_PREFIX}builder`,
      JSON.stringify({
        committedSource: validSource,
        history: [firstSnapshot, currentSnapshot],
        redoHistory: [firstSnapshot],
        previousChangeSummaries: ['Old change.'],
      }),
    );

    const persisted = JSON.parse(storageData.get(`${REMEMBER_PREFIX}builder`) ?? '{}') as {
      history?: unknown[];
      redoHistory?: unknown[];
      previousChangeSummaries?: unknown[];
    };

    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(persisted.history).toHaveLength(1);
    expect(persisted.redoHistory).toEqual([]);
    expect(persisted.previousChangeSummaries).toEqual([]);
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kitto:persistence-warning',
        detail: {
          message: BUILDER_PERSISTENCE_QUOTA_WARNING,
        },
      }),
    );
  });

  it('clears only Kitto remembered keys and resets dependent slices when builder JSON is corrupted', () => {
    const clearSpy = vi.spyOn(window.localStorage, 'clear').mockImplementation(() => {});
    const removeItemSpy = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {});

    const restored = unserializeRememberedState('{"data"', 'builder');
    const restoredBuilderSession = unserializeRememberedState(
      JSON.stringify({
        runtimeSessionState: {
          currentScreen: 'details',
        },
      }),
      'builderSession',
    );
    const restoredDomain = unserializeRememberedState(
      JSON.stringify({
        data: {
          app: {
            submissions: [{ answer: 'Ada' }],
          },
        },
      }),
      'domain',
    );

    expect(restored).toEqual(normalizeBuilderState(undefined));
    expect(restoredBuilderSession).toEqual({ runtimeSessionState: {} });
    expect(restoredDomain).toEqual({ data: {} });
    expect(clearSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).toHaveBeenCalledTimes(REMEMBER_KEYS.length);

    for (const key of REMEMBER_KEYS) {
      expect(removeItemSpy).toHaveBeenCalledWith(`${REMEMBER_PREFIX}${key}`);
    }
  });

  it('drops builderSession to the default state when the restored shape is invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restored = unserializeRememberedState('"oops"', 'builderSession');

    expect(restored).toEqual({ runtimeSessionState: {} });
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        reason: expect.any(String),
        slice: 'builderSession',
      }),
    );
  });

  it('drops corrupted JSON to the default domain state without crashing restore', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restored = unserializeRememberedState('{"data"', 'domain');

    expect(restored).toEqual({ data: {} });
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        reason: expect.any(String),
        slice: 'domain',
      }),
    );
  });

  it('drops prototype-polluting domain payloads without mutating Object.prototype', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restored = unserializeRememberedState('{"__proto__":{"x":1}}', 'domain');

    expect(restored).toEqual({ data: {} });
    expect(({} as { x?: number }).x).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        reason: expect.stringContaining('__proto__'),
        slice: 'domain',
      }),
    );
  });

  it('drops partial domain shapes to the default state', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restored = unserializeRememberedState('{"data":[]}', 'domain');

    expect(restored).toEqual({ data: {} });
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
        expect.objectContaining({
          kind: 'persistence/dropped',
          reason: expect.any(String),
          slice: 'domain',
        }),
    );
  });

  it('drops legacy builderSession runtimeState/formState payloads instead of migrating them', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restored = unserializeRememberedState(
      JSON.stringify({
        runtimeState: { currentScreen: 'main' },
        formState: { accepted: true },
      }),
      'builderSession',
    );

    expect(restored).toEqual({ runtimeSessionState: {} });
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        slice: 'builderSession',
      }),
    );
  });

  it('drops legacy raw-object domain payloads instead of treating them as current state', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restored = unserializeRememberedState(JSON.stringify({ app: { submissions: [] } }), 'domain');

    expect(restored).toEqual({ data: {} });
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        slice: 'domain',
      }),
    );
  });

  it('keeps the persistence whitelist aligned with the slices restored on reload', () => {
    expect(REMEMBER_KEYS).toEqual(['builder', 'builderSession', 'domain']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { migrateRememberedState, REMEMBER_KEYS, unserializeRememberedState } from '@store/persistence';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

function createPersistedBuilder(snapshot: ReturnType<typeof createBuilderSnapshot>) {
  return {
    activeTab: 'preview',
    committedSource: snapshot.source,
    history: [snapshot],
    parseIssues: [],
    streamedSource: snapshot.source,
  };
}

describe('store persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores runtimeSessionState across a simulated reload migration', async () => {
    const snapshot = createBuilderSnapshot(
      validSource,
      { currentScreen: 'main' },
      { app: { submissions: [] as string[] } },
    );
    const liveRuntimeState = {
      currentScreen: 'details',
      selectedPlan: 'pro',
    };

    const migrated = await migrateRememberedState({
      builder: createPersistedBuilder(snapshot),
      builderSession: unserializeRememberedState(JSON.stringify({ runtimeSessionState: liveRuntimeState }), 'builderSession'),
    });

    expect(migrated.builder.committedSource).toBe(validSource);
    expect(migrated.builder.history).toHaveLength(1);
    expect(migrated.builderSession.runtimeSessionState).toEqual(liveRuntimeState);
    expect(migrated.domain.data).toEqual({});
  });

  it('restores domain.data across a simulated reload migration', async () => {
    const snapshot = createBuilderSnapshot(
      validSource,
      { currentScreen: 'main' },
      { app: { submissions: [] as string[] } },
    );
    const liveDomainData = {
      app: {
        submissions: [{ answer: 'Ada' }],
      },
    };

    const migrated = await migrateRememberedState({
      builder: createPersistedBuilder(snapshot),
      domain: unserializeRememberedState(JSON.stringify({ data: liveDomainData }), 'domain'),
    });

    expect(migrated.builder.committedSource).toBe(validSource);
    expect(migrated.builderSession.runtimeSessionState).toEqual({});
    expect(migrated.domain.data).toEqual(liveDomainData);
  });

  it('drops builderSession to the default state when the restored shape is invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = await migrateRememberedState({
      builderSession: unserializeRememberedState('"oops"', 'builderSession'),
    });

    expect(migrated.builderSession.runtimeSessionState).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        reason: expect.any(String),
        slice: 'builderSession',
      }),
    );
  });

  it('drops corrupted JSON to the default domain state without crashing restore', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = await migrateRememberedState({
      domain: unserializeRememberedState('{"data"', 'domain'),
    });

    expect(migrated.domain.data).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        reason: expect.any(String),
        slice: 'domain',
      }),
    );
  });

  it('drops prototype-polluting domain payloads without mutating Object.prototype', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = await migrateRememberedState({
      domain: unserializeRememberedState('{"__proto__":{"x":1}}', 'domain'),
    });

    expect(migrated.domain.data).toEqual({});
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

  it('drops partial domain shapes to the default state', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const migrated = await migrateRememberedState({
      domain: unserializeRememberedState('{"data":[]}', 'domain'),
    });

    expect(migrated.domain.data).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      '[app.recovery]',
      expect.objectContaining({
        kind: 'persistence/dropped',
        reason: expect.any(String),
        slice: 'domain',
      }),
    );
  });

  it('keeps the persistence whitelist aligned with the slices restored on reload', () => {
    expect(REMEMBER_KEYS).toEqual(['builder', 'builderSession', 'domain']);
  });
});

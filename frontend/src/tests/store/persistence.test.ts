import { describe, expect, it } from 'vitest';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { migrateRememberedState, REMEMBER_KEYS } from '@store/persistence';

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
  it('persists live runtime state across restore', async () => {
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
      builderSession: { runtimeSessionState: liveRuntimeState },
    });

    expect(migrated.builder.committedSource).toBe(validSource);
    expect(migrated.builder.history).toHaveLength(1);
    expect(migrated.builderSession.runtimeSessionState).toEqual(liveRuntimeState);
    expect(migrated.domain.data).toEqual(snapshot.domainData);
  });

  it('persists live domain data across restore', async () => {
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
      domain: { data: liveDomainData },
    });

    expect(migrated.builder.committedSource).toBe(validSource);
    expect(migrated.builderSession.runtimeSessionState).toEqual(snapshot.runtimeState);
    expect(migrated.domain.data).toEqual(liveDomainData);
  });

  it('falls back to the latest snapshot when persisted live slices are corrupted', async () => {
    const snapshot = createBuilderSnapshot(
      validSource,
      { currentScreen: 'main', selectedPlan: 'basic' },
      { app: { submissions: [{ answer: 'Grace' }] } },
    );

    const migrated = await migrateRememberedState({
      builder: createPersistedBuilder(snapshot),
      builderSession: { runtimeSessionState: 'broken-state' },
      domain: { data: ['broken-domain'] },
    });

    expect(migrated.builderSession.runtimeSessionState).toEqual(snapshot.runtimeState);
    expect(migrated.domain.data).toEqual(snapshot.domainData);
  });

  it('keeps the persistence whitelist aligned with the slices restored on reload', () => {
    expect(REMEMBER_KEYS).toEqual(['builder', 'builderSession', 'domain']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  createBuilderSnapshot,
  createResetDefinitionExport,
  parseImportedDefinition,
} from '@features/builder/openui/runtime/persistedState';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

describe('persistedState', () => {
  it('creates snapshots with cloned runtime, domain, and baseline state', () => {
    const runtimeState = {
      form: {
        name: 'Ada',
      },
    };
    const domainData = {
      app: {
        users: ['Ada'],
      },
    };
    const initialRuntimeState = {
      form: {
        name: '',
      },
    };
    const initialDomainData = {
      app: {
        users: [] as string[],
      },
    };

    const snapshot = createBuilderSnapshot(validSource, runtimeState, domainData, {
      initialDomainData,
      initialRuntimeState,
    });

    runtimeState.form.name = 'Grace';
    domainData.app.users.push('Grace');
    initialRuntimeState.form.name = 'Edited';
    initialDomainData.app.users.push('Edited');

    expect(snapshot.runtimeState).toEqual({
      form: {
        name: 'Ada',
      },
    });
    expect(snapshot.domainData).toEqual({
      app: {
        users: ['Ada'],
      },
    });
    expect(snapshot.initialRuntimeState).toEqual({
      form: {
        name: '',
      },
    });
    expect(snapshot.initialDomainData).toEqual({
      app: {
        users: [],
      },
    });
  });

  it('creates a reset export from the latest snapshot baseline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T08:30:00.000Z'));

    const history = [
      createBuilderSnapshot('broken source', { stale: true }, { stale: true }),
      createBuilderSnapshot(
        validSource,
        { currentScreen: 'review' },
        { app: { submissions: ['current'] } },
        {
          initialRuntimeState: { currentScreen: 'intro' },
          initialDomainData: { app: { submissions: [] as string[] } },
        },
      ),
    ];

    const exported = createResetDefinitionExport(validSource, history);

    expect(exported.version).toBe(1);
    expect(exported.source).toBe(validSource);
    expect(exported.runtimeState).toEqual({ currentScreen: 'intro' });
    expect(exported.domainData).toEqual({ app: { submissions: [] } });
    expect(exported.history).toHaveLength(1);
    expect(exported.history[0]).toMatchObject({
      source: validSource,
      runtimeState: { currentScreen: 'intro' },
      domainData: { app: { submissions: [] } },
      initialRuntimeState: { currentScreen: 'intro' },
      initialDomainData: { app: { submissions: [] } },
      committedAt: '2026-04-19T08:30:00.000Z',
    });

    vi.useRealTimers();
  });

  it('creates a reset export with empty state when no history exists', () => {
    const exported = createResetDefinitionExport(validSource, []);

    expect(exported).toMatchObject({
      version: 1,
      source: validSource,
      runtimeState: {},
      domainData: {},
    });
    expect(exported.history).toHaveLength(1);
    expect(exported.history[0]).toMatchObject({
      source: validSource,
      runtimeState: {},
      domainData: {},
    });
  });

  it('parses a valid import and synthesizes history when the export omits it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T09:00:00.000Z'));

    const imported = parseImportedDefinition(
      JSON.stringify({
        version: 1,
        source: validSource,
        runtimeState: { currentScreen: 'main' },
        domainData: { app: { tasks: [] as string[] } },
      }),
    );

    expect(imported.history).toHaveLength(1);
    expect(imported.history[0]).toMatchObject({
      source: validSource,
      runtimeState: { currentScreen: 'main' },
      domainData: { app: { tasks: [] } },
      initialRuntimeState: { currentScreen: 'main' },
      initialDomainData: { app: { tasks: [] } },
      committedAt: '2026-04-19T09:00:00.000Z',
    });

    vi.useRealTimers();
  });

  it('rejects unsupported import versions', () => {
    expect(() =>
      parseImportedDefinition(
        JSON.stringify({
          version: 2,
          source: validSource,
          runtimeState: {},
          domainData: {},
          history: [],
        }),
      ),
    ).toThrow('Import file uses version 2. Expected a Kitto definition export with version 1.');
  });

  it('throws a readable error when the import file is not valid JSON', () => {
    expect(() => parseImportedDefinition('{')).toThrow('Import file is not valid JSON.');
  });

  it('keeps invalid imported source available for the rejected import path', () => {
    const imported = parseImportedDefinition(
      JSON.stringify({
        version: 1,
        source: 'root = UnknownComponent([])',
        runtimeState: {},
        domainData: {},
        history: [],
      }),
    );

    expect(imported.source).toBe('root = UnknownComponent([])');
  });
});

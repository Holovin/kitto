import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuilderSnapshot } from '@pages/Chat/builder/openui/runtime/persistedState';
import { createStandalonePayload } from '@pages/Chat/builder/standalone/createStandalonePayload';

const validSource = 'root = AppShell([])';

describe('createStandalonePayload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the committed source and the matching snapshot baseline state instead of current live state', () => {
    const snapshot = createBuilderSnapshot(
      validSource,
      { currentScreen: 'result', form: { name: 'Ada' } },
      { app: { submissions: ['live'] } },
      {
        initialRuntimeState: { currentScreen: 'intro' },
        initialDomainData: { app: { submissions: [] as string[] } },
      },
    );

    const payload = createStandalonePayload({
      committedSource: validSource,
      history: [snapshot],
      title: 'Quiz export',
    });

    expect(payload.source).toBe(validSource);
    expect(payload.title).toBe('Quiz export');
    expect(payload.initialRuntimeState).toEqual({ currentScreen: 'intro' });
    expect(payload.initialDomainData).toEqual({ app: { submissions: [] } });
    expect(payload.initialRuntimeState).not.toEqual(snapshot.runtimeState);
    expect(payload.initialDomainData).not.toEqual(snapshot.domainData);
  });

  it('ignores later non-committed history entries and keeps the payload free of chat or draft fields', () => {
    const committedSnapshot = createBuilderSnapshot(
      validSource,
      { currentScreen: 'summary' },
      { app: { steps: ['committed'] } },
      {
        initialRuntimeState: { currentScreen: 'intro' },
        initialDomainData: { app: { steps: ['baseline'] } },
      },
    );
    const unrelatedLaterSnapshot = createBuilderSnapshot('root = AppShell([Text("draft", "body", "start")])', { draft: true }, { app: { steps: ['draft'] } });
    const payload = createStandalonePayload({
      committedSource: validSource,
      history: [committedSnapshot, unrelatedLaterSnapshot],
    });

    expect(payload.source).toBe(validSource);
    expect(payload.initialRuntimeState).toEqual({ currentScreen: 'intro' });
    expect(payload.initialDomainData).toEqual({ app: { steps: ['baseline'] } });
    expect(payload).not.toHaveProperty('chatHistory');
    expect(payload).not.toHaveProperty('history');
    expect(payload).not.toHaveProperty('streamedSource');
  });

  it('falls back to empty baseline state when the committed snapshot is unavailable', () => {
    const payload = createStandalonePayload({
      committedSource: validSource,
      history: [],
    });

    expect(payload.initialRuntimeState).toEqual({});
    expect(payload.initialDomainData).toEqual({});
    expect(payload.exportId).toMatch(/^v1-/);
    expect(payload.storageKey).toBe(`kitto:standalone:${payload.exportId}`);
  });

  it('uses crypto.randomUUID for the export id', () => {
    const randomUUID = vi.fn(() => 'standalone-uuid');

    vi.stubGlobal('crypto', { randomUUID });

    const payload = createStandalonePayload({
      committedSource: validSource,
      history: [],
    });

    expect(payload.exportId).toBe('v1-standalone-uuid');
    expect(payload.storageKey).toBe('kitto:standalone:v1-standalone-uuid');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('creates a unique storage identity for each export of the same committed source', () => {
    const firstPayload = createStandalonePayload({
      committedSource: validSource,
      history: [],
    });
    const secondPayload = createStandalonePayload({
      committedSource: validSource,
      history: [],
    });

    expect(firstPayload.source).toBe(secondPayload.source);
    expect(firstPayload.exportId).not.toBe(secondPayload.exportId);
    expect(firstPayload.storageKey).not.toBe(secondPayload.storageKey);
  });

  it('rejects invalid committed source before export', () => {
    expect(() =>
      createStandalonePayload({
        committedSource: 'not valid openui',
        history: [],
      }),
    ).toThrow('Current committed definition is invalid.');
  });
});

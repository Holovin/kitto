import { describe, expect, it } from 'vitest';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { createStandalonePayload } from '@features/builder/standalone/createStandalonePayload';

const validSource = 'root = AppShell([])';

describe('createStandalonePayload', () => {
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
    expect(payload.storageKey).toBe(`kitto:standalone:${payload.appId}`);
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

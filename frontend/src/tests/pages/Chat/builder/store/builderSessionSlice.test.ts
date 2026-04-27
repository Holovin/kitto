import { describe, expect, it } from 'vitest';
import { validateRestoredBuilderSessionResult } from '@pages/Chat/builder/store/builderSessionSlice';

describe('builderSessionSlice', () => {
  it('restores runtimeSessionState keys that use OpenUI runtime variable names', () => {
    const runtimeSessionState = {
      $currentScreen: 'details',
      $draft: {
        title: 'Ada',
      },
      $lastChoice: 'pro',
    };

    expect(validateRestoredBuilderSessionResult({ runtimeSessionState })).toEqual({
      reason: null,
      state: {
        runtimeSessionState,
      },
    });
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects forbidden runtimeSessionState key "%s"', (forbiddenKey) => {
    const restored = validateRestoredBuilderSessionResult(
      JSON.parse(`{"runtimeSessionState":{"${forbiddenKey}":{"polluted":true}}}`) as unknown,
    );

    expect(restored.state).toBeNull();
    expect(restored.reason).toContain(forbiddenKey);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

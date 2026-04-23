import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMEMBER_KEYS, unserializeRememberedState } from '@store/persistence';

describe('store persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

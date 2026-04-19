import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { REMEMBER_KEYS, REMEMBER_PREFIX } from '@store/persistence';

vi.mock('@store/store', () => ({
  store: {
    dispatch: vi.fn(),
  },
}));

describe('errorRecovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      localStorage: {
        removeItem: vi.fn(),
      },
      location: {
        reload: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears all persisted slices and resets app state', async () => {
    const { resetAppState } = await import('@store/errorRecovery');
    const { store } = await import('@store/store');

    resetAppState();

    expect(window.localStorage.removeItem).toHaveBeenCalledTimes(REMEMBER_KEYS.length);

    for (const key of REMEMBER_KEYS) {
      expect(window.localStorage.removeItem).toHaveBeenCalledWith(`${REMEMBER_PREFIX}${key}`);
    }

    expect(store.dispatch).toHaveBeenNthCalledWith(1, domainActions.resetDomainState());
    expect(store.dispatch).toHaveBeenNthCalledWith(2, builderSessionActions.resetRuntimeSessionState());
    expect(store.dispatch).toHaveBeenNthCalledWith(3, builderActions.resetToEmpty());
  });
});

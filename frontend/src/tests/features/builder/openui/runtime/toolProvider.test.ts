import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainActions, domainReducer } from '@features/builder/store/domainSlice';

type MockState = {
  domain: ReturnType<typeof domainReducer>;
};

let mockState: MockState = {
  domain: domainReducer(undefined, { type: 'domain/test-init' }),
};

const mockStore = {
  dispatch(action: unknown) {
    mockState = {
      domain: domainReducer(mockState.domain, action as never),
    };

    return action;
  },
  getState() {
    return mockState;
  },
};

vi.mock('@store/store', () => ({
  store: mockStore,
}));

let builderToolProvider: typeof import('@features/builder/openui/runtime/toolProvider').builderToolProvider;

function seedDomainData(data: Record<string, unknown>) {
  mockStore.dispatch(domainActions.replaceData(data));
}

describe('builderToolProvider', () => {
  beforeAll(async () => {
    ({ builderToolProvider } = await import('@features/builder/openui/runtime/toolProvider'));
  });

  beforeEach(() => {
    mockState = {
      domain: domainReducer(undefined, { type: 'domain/test-reset' }),
    };
  });

  it('rejects write_state when path is empty', async () => {
    await expect(builderToolProvider.write_state({ path: '   ', value: 'Ada' })).rejects.toThrow('write_state: State path must be a non-empty dot-path.');
    expect(mockState.domain.data).toEqual({});
  });

  it('rejects remove_state without an explicit index', async () => {
    seedDomainData({
      app: {
        tasks: ['first', 'second'],
      },
    });

    await expect(builderToolProvider.remove_state({ path: 'app.tasks' })).rejects.toThrow('remove_state: index must be a non-negative integer.');
    expect(mockState.domain.data).toEqual({
      app: {
        tasks: ['first', 'second'],
      },
    });
  });

  it('rejects remove_state when the target path is not an array', async () => {
    seedDomainData({
      app: {
        tasks: {
          title: 'not an array',
        },
      },
    });

    await expect(builderToolProvider.remove_state({ path: 'app.tasks', index: 0 })).rejects.toThrow(
      'remove_state: State path "app.tasks" does not contain an array value.',
    );
    expect(mockState.domain.data).toEqual({
      app: {
        tasks: {
          title: 'not an array',
        },
      },
    });
  });

  it('removes only the requested item for a valid remove_state call', async () => {
    seedDomainData({
      app: {
        tasks: ['first', 'second', 'third'],
      },
    });

    await expect(builderToolProvider.remove_state({ path: 'app.tasks', index: 1 })).resolves.toEqual(['first', 'third']);
    expect(mockState.domain.data).toEqual({
      app: {
        tasks: ['first', 'third'],
      },
    });
  });

  it('appends to a valid array path', async () => {
    seedDomainData({
      app: {
        tasks: [{ title: 'Draft tests' }],
      },
    });

    await expect(builderToolProvider.append_state({ path: 'app.tasks', value: { title: 'Ship fix' } })).resolves.toEqual([
      { title: 'Draft tests' },
      { title: 'Ship fix' },
    ]);
    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [{ title: 'Draft tests' }, { title: 'Ship fix' }],
      },
    });
  });
});

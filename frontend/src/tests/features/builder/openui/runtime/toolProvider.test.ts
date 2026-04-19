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

  it('rejects merge_state when path is empty', async () => {
    await expect(builderToolProvider.merge_state({ path: '   ', patch: { name: 'Ada' } })).rejects.toThrow(
      'merge_state: State path must be a non-empty dot-path.',
    );
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

  it('rejects remove_state with a negative index', async () => {
    seedDomainData({
      app: {
        tasks: ['first', 'second'],
      },
    });

    await expect(builderToolProvider.remove_state({ path: 'app.tasks', index: -1 })).rejects.toThrow(
      'remove_state: index must be a non-negative integer.',
    );
    expect(mockState.domain.data).toEqual({
      app: {
        tasks: ['first', 'second'],
      },
    });
  });

  it('writes to a valid state path', async () => {
    await expect(builderToolProvider.write_state({ path: 'app.profile.name', value: 'Ada' })).resolves.toBe('Ada');
    expect(mockState.domain.data).toEqual({
      app: {
        profile: {
          name: 'Ada',
        },
      },
    });
  });

  it('reads from a valid state path without exposing the stored reference', async () => {
    seedDomainData({
      app: {
        profile: {
          name: 'Ada',
        },
      },
    });

    const value = await builderToolProvider.read_state({ path: 'app.profile' });

    expect(value).toEqual({
      name: 'Ada',
    });

    (value as { name: string }).name = 'Grace';

    expect(mockState.domain.data).toEqual({
      app: {
        profile: {
          name: 'Ada',
        },
      },
    });
  });

  it('merges safe patch fields while stripping dangerous keys', async () => {
    seedDomainData({
      app: {
        profile: {
          name: 'Ada',
          role: 'engineer',
        },
      },
    });
    const patch = JSON.parse('{"name":"Grace","__proto__":{"polluted":true},"prototype":{"danger":true},"constructor":{"danger":true}}') as Record<
      string,
      unknown
    >;

    await expect(builderToolProvider.merge_state({ path: 'app.profile', patch })).resolves.toEqual({
      name: 'Grace',
      role: 'engineer',
    });
    expect(mockState.domain.data).toEqual({
      app: {
        profile: {
          name: 'Grace',
          role: 'engineer',
        },
      },
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
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

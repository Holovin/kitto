import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

function createTaskRows() {
  return [
    {
      id: 'task-1',
      title: 'Draft tests',
      completed: false,
    },
    {
      id: 'task-2',
      title: 'Ship fix',
      completed: true,
    },
  ];
}

describe('builderToolProvider', () => {
  beforeAll(async () => {
    ({ builderToolProvider } = await import('@features/builder/openui/runtime/toolProvider'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('append_item appends plain-object rows and generates stable ids', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'generated-item-id',
    });
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { title: 'Review docs', completed: false },
      }),
    ).resolves.toEqual([
      ...createTaskRows(),
      { id: 'generated-item-id', title: 'Review docs', completed: false },
    ]);

    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [...createTaskRows(), { id: 'generated-item-id', title: 'Review docs', completed: false }],
      },
    });
  });

  it('append_item replaces blank and whitespace ids with generated stable ids', async () => {
    let idCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `generated-item-id-${++idCounter}`,
    });
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { id: '', title: 'Blank id', completed: false },
      }),
    ).resolves.toEqual([
      ...createTaskRows(),
      { id: 'generated-item-id-1', title: 'Blank id', completed: false },
    ]);

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { id: '   ', title: 'Whitespace id', completed: false },
      }),
    ).resolves.toEqual([
      ...createTaskRows(),
      { id: 'generated-item-id-1', title: 'Blank id', completed: false },
      { id: 'generated-item-id-2', title: 'Whitespace id', completed: false },
    ]);

    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [
          ...createTaskRows(),
          { id: 'generated-item-id-1', title: 'Blank id', completed: false },
          { id: 'generated-item-id-2', title: 'Whitespace id', completed: false },
        ],
      },
    });
  });

  it('append_item falls back to nanoid when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', {});

    const result = (await builderToolProvider.append_item({
      path: 'app.tasks',
      value: { title: 'Offline-safe row', completed: false },
    })) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(typeof result[0]?.id).toBe('string');
    expect((result[0]?.id as string).length).toBeGreaterThan(0);
    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [
          {
            id: result[0]?.id,
            title: 'Offline-safe row',
            completed: false,
          },
        ],
      },
    });
  });

  it('rejects append_item when the value is not a plain object', async () => {
    await expect(builderToolProvider.append_item({ path: 'app.tasks', value: ['broken'] })).rejects.toThrow(
      'append_item: value must be a plain object.',
    );
    expect(mockState.domain.data).toEqual({});
  });

  it('rejects append_item when the target path is not an array', async () => {
    seedDomainData({
      app: {
        tasks: {
          broken: true,
        },
      },
    });

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { title: 'Broken', completed: false },
      }),
    ).rejects.toThrow('append_item: State path "app.tasks" does not contain an array value.');

    expect(mockState.domain.data).toEqual({
      app: {
        tasks: {
          broken: true,
        },
      },
    });
  });

  it('toggle_item_field toggles one matched row field by id', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.toggle_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
        field: 'completed',
      }),
    ).resolves.toEqual([
      { id: 'task-1', title: 'Draft tests', completed: true },
      { id: 'task-2', title: 'Ship fix', completed: true },
    ]);

    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [
          { id: 'task-1', title: 'Draft tests', completed: true },
          { id: 'task-2', title: 'Ship fix', completed: true },
        ],
      },
    });
  });

  it('rejects toggle_item_field when idField is unsafe', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.toggle_item_field({
        path: 'app.tasks',
        idField: '__proto__',
        id: 'task-1',
        field: 'completed',
      }),
    ).rejects.toThrow('toggle_item_field: idField "__proto__" contains the forbidden segment "__proto__".');

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects toggle_item_field when field is unsafe', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.toggle_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
        field: '__proto__',
      }),
    ).rejects.toThrow('toggle_item_field: field "__proto__" contains the forbidden segment "__proto__".');

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects toggle_item_field when the target path is not an array', async () => {
    seedDomainData({
      app: {
        tasks: {
          broken: true,
        },
      },
    });

    await expect(
      builderToolProvider.toggle_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
        field: 'completed',
      }),
    ).rejects.toThrow('toggle_item_field: State path "app.tasks" does not contain an array value.');
  });

  it('rejects toggle_item_field when the target id is missing', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.toggle_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'missing-task',
        field: 'completed',
      }),
    ).rejects.toThrow('toggle_item_field: State path "app.tasks" does not contain an item with id="missing-task".');
  });

  it('rejects toggle_item_field when id is blank', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.toggle_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: '   ',
        field: 'completed',
      }),
    ).rejects.toThrow('toggle_item_field: id must be a non-empty string or finite number.');
  });

  it('update_item_field replaces one matched row field by id', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.update_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
        field: 'title',
        value: 'Review specs',
      }),
    ).resolves.toEqual([
      { id: 'task-1', title: 'Review specs', completed: false },
      { id: 'task-2', title: 'Ship fix', completed: true },
    ]);

    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [
          { id: 'task-1', title: 'Review specs', completed: false },
          { id: 'task-2', title: 'Ship fix', completed: true },
        ],
      },
    });
  });

  it('rejects update_item_field when idField is unsafe', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.update_item_field({
        path: 'app.tasks',
        idField: '__proto__',
        id: 'task-1',
        field: 'title',
        value: 'Broken',
      }),
    ).rejects.toThrow('update_item_field: idField "__proto__" contains the forbidden segment "__proto__".');

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects update_item_field when field is unsafe', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.update_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
        field: '__proto__',
        value: 'Broken',
      }),
    ).rejects.toThrow('update_item_field: field "__proto__" contains the forbidden segment "__proto__".');

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects update_item_field when the target path is not an array', async () => {
    seedDomainData({
      app: {
        tasks: {
          broken: true,
        },
      },
    });

    await expect(
      builderToolProvider.update_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
        field: 'title',
        value: 'Broken',
      }),
    ).rejects.toThrow('update_item_field: State path "app.tasks" does not contain an array value.');
  });

  it('rejects update_item_field when the target id is missing', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.update_item_field({
        path: 'app.tasks',
        idField: 'id',
        id: 'missing-task',
        field: 'title',
        value: 'Broken',
      }),
    ).rejects.toThrow('update_item_field: State path "app.tasks" does not contain an item with id="missing-task".');
  });

  it('remove_item deletes one matched row by id', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.remove_item({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
      }),
    ).resolves.toEqual([{ id: 'task-2', title: 'Ship fix', completed: true }]);

    expect(mockState.domain.data).toEqual({
      app: {
        tasks: [{ id: 'task-2', title: 'Ship fix', completed: true }],
      },
    });
  });

  it('rejects remove_item when idField is unsafe', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.remove_item({
        path: 'app.tasks',
        idField: '__proto__',
        id: 'task-1',
      }),
    ).rejects.toThrow('remove_item: idField "__proto__" contains the forbidden segment "__proto__".');

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects remove_item when the target path is not an array', async () => {
    seedDomainData({
      app: {
        tasks: {
          broken: true,
        },
      },
    });

    await expect(
      builderToolProvider.remove_item({
        path: 'app.tasks',
        idField: 'id',
        id: 'task-1',
      }),
    ).rejects.toThrow('remove_item: State path "app.tasks" does not contain an array value.');
  });

  it('rejects remove_item when the target id is missing', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.remove_item({
        path: 'app.tasks',
        idField: 'id',
        id: 'missing-task',
      }),
    ).rejects.toThrow('remove_item: State path "app.tasks" does not contain an item with id="missing-task".');
  });

  it('rejects remove_item when id is not finite', async () => {
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.remove_item({
        path: 'app.tasks',
        idField: 'id',
        id: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow('remove_item: id must be a non-empty string or finite number.');
  });

  it('exposes compute tools and returns { value } for read-only computations', async () => {
    expect(builderToolProvider).toHaveProperty('compute_value');
    expect(builderToolProvider).toHaveProperty('write_computed_state');

    await expect(
      builderToolProvider.compute_value({
        op: 'not_empty',
        input: 'Ada',
        returnType: 'boolean',
      }),
    ).resolves.toEqual({ value: true });
  });

  it('writes computed primitive values to valid state paths', async () => {
    await expect(
      builderToolProvider.write_computed_state({
        path: 'app.roll',
        op: 'random_int',
        options: { min: 4, max: 4 },
        returnType: 'number',
      }),
    ).resolves.toEqual({ value: 4 });

    expect(mockState.domain.data).toEqual({
      app: {
        roll: 4,
      },
    });
  });

  it('rejects write_computed_state when the path is invalid', async () => {
    await expect(
      builderToolProvider.write_computed_state({
        path: '   ',
        op: 'random_int',
      }),
    ).rejects.toThrow('write_computed_state: State path must be a non-empty dot-path.');

    expect(mockState.domain.data).toEqual({});
  });
});

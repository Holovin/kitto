import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomainToolProvider } from '@pages/Chat/builder/openui/runtime/createDomainToolProvider';
import { createBuilderToolProvider } from '@pages/Chat/builder/openui/runtime/toolProvider';

let domainData: Record<string, unknown> = {};
let builderToolProvider: ReturnType<typeof createDomainToolProvider>;

function cloneDomainData(data: Record<string, unknown>) {
  return structuredClone(data);
}

function seedDomainData(data: Record<string, unknown>) {
  domainData = cloneDomainData(data);
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

describe('createDomainToolProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    domainData = {};
    builderToolProvider = createDomainToolProvider({
      readDomainData: () => domainData,
      replaceDomainData: (nextData) => {
        domainData = cloneDomainData(nextData);
      },
    });
  });

  it('rejects write_state when path is empty', async () => {
    await expect(builderToolProvider.write_state({ path: '   ', value: 'Ada' })).rejects.toThrow('write_state: State path must be a non-empty dot-path.');
    expect(domainData).toEqual({});
  });

  it('rejects merge_state when path is empty', async () => {
    await expect(builderToolProvider.merge_state({ path: '   ', patch: { name: 'Ada' } })).rejects.toThrow(
      'merge_state: State path must be a non-empty dot-path.',
    );
    expect(domainData).toEqual({});
  });

  it('rejects remove_state without an explicit index', async () => {
    seedDomainData({
      app: {
        tasks: ['first', 'second'],
      },
    });

    await expect(builderToolProvider.remove_state({ path: 'app.tasks' })).rejects.toThrow('remove_state: index must be a non-negative integer.');
    expect(domainData).toEqual({
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
    expect(domainData).toEqual({
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
    expect(domainData).toEqual({
      app: {
        tasks: ['first', 'second'],
      },
    });
  });

  it('writes to a valid state path', async () => {
    await expect(builderToolProvider.write_state({ path: 'app.profile.name', value: 'Ada' })).resolves.toBe('Ada');
    expect(domainData).toEqual({
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

    expect(domainData).toEqual({
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
    expect(domainData).toEqual({
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
    expect(domainData).toEqual({
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
    expect(domainData).toEqual({
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

    expect(domainData).toEqual({
      app: {
        tasks: [...createTaskRows(), { id: 'generated-item-id', title: 'Review docs', completed: false }],
      },
    });
  });

  it('append_item keeps unique explicit ids', async () => {
    const randomUUID = vi.fn(() => 'unused-generated-id');
    vi.stubGlobal('crypto', { randomUUID });
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { id: 'task-3', title: 'Review docs', completed: false },
      }),
    ).resolves.toEqual([
      ...createTaskRows(),
      { id: 'task-3', title: 'Review docs', completed: false },
    ]);

    expect(randomUUID).not.toHaveBeenCalled();
    expect(domainData).toEqual({
      app: {
        tasks: [...createTaskRows(), { id: 'task-3', title: 'Review docs', completed: false }],
      },
    });
  });

  it('append_item replaces duplicate explicit ids with generated stable ids', async () => {
    const randomUUID = vi.fn(() => 'generated-item-id');
    vi.stubGlobal('crypto', { randomUUID });
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { id: 'task-1', title: 'Duplicate id', completed: false },
      }),
    ).resolves.toEqual([
      ...createTaskRows(),
      { id: 'generated-item-id', title: 'Duplicate id', completed: false },
    ]);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(domainData).toEqual({
      app: {
        tasks: [...createTaskRows(), { id: 'generated-item-id', title: 'Duplicate id', completed: false }],
      },
    });
  });

  it('append_item retries generated ids when they collide with existing rows', async () => {
    const generatedIds = ['task-1', 'task-2', 'generated-item-id'];
    const randomUUID = vi.fn(() => generatedIds.shift() ?? 'generated-item-id');
    vi.stubGlobal('crypto', { randomUUID });
    seedDomainData({
      app: {
        tasks: createTaskRows(),
      },
    });

    await expect(
      builderToolProvider.append_item({
        path: 'app.tasks',
        value: { title: 'Collision-safe row', completed: false },
      }),
    ).resolves.toEqual([
      ...createTaskRows(),
      { id: 'generated-item-id', title: 'Collision-safe row', completed: false },
    ]);

    expect(randomUUID).toHaveBeenCalledTimes(3);
    expect(domainData).toEqual({
      app: {
        tasks: [...createTaskRows(), { id: 'generated-item-id', title: 'Collision-safe row', completed: false }],
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

    expect(domainData).toEqual({
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
    expect(domainData).toEqual({
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
    expect(domainData).toEqual({});
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

    expect(domainData).toEqual({
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

    expect(domainData).toEqual({
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

    expect(domainData).toEqual({
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

    expect(domainData).toEqual({
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

  it('rejects compute_value when compute arguments are invalid', async () => {
    await expect(
      builderToolProvider.compute_value({
        op: 'run_js',
      }),
    ).rejects.toThrow('compute_value: Unknown compute op "run_js".');

    await expect(
      builderToolProvider.compute_value({
        op: 'and',
        values: 'not-an-array',
      }),
    ).rejects.toThrow('compute_value: values must be an array.');

    await expect(
      builderToolProvider.compute_value({
        op: 'truthy',
        returnType: 'object',
      }),
    ).rejects.toThrow('compute_value: returnType must be one of "string", "number", "boolean".');
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

    expect(domainData).toEqual({
      app: {
        roll: 4,
      },
    });
  });

  it('rejects write_computed_state when compute arguments are invalid without mutating state', async () => {
    seedDomainData({
      app: {
        roll: 2,
      },
    });

    await expect(
      builderToolProvider.write_computed_state({
        path: 'app.roll',
        op: 'random_int',
        options: ['bad-options'],
      }),
    ).rejects.toThrow('write_computed_state: options must be a plain object.');

    expect(domainData).toEqual({
      app: {
        roll: 2,
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

    expect(domainData).toEqual({});
  });
});

describe('createBuilderToolProvider', () => {
  it('replaces domain data and syncs the latest builder snapshot for mutations', async () => {
    let localDomainData: Record<string, unknown> = {};
    let replacedDomainData: Record<string, unknown> | null = null;
    let syncedSnapshotDomainData: Record<string, unknown> | null = null;
    const toolProvider = createBuilderToolProvider({
      readDomainData: () => localDomainData,
      replaceDomainData: (nextData) => {
        replacedDomainData = cloneDomainData(nextData);
        localDomainData = cloneDomainData(nextData);
      },
      syncLatestSnapshotDomainData: (nextData) => {
        syncedSnapshotDomainData = cloneDomainData(nextData);
      },
    });

    await expect(toolProvider.write_state({ path: 'app.profile.name', value: 'Ada' })).resolves.toBe('Ada');

    expect(replacedDomainData).toEqual({
      app: {
        profile: {
          name: 'Ada',
        },
      },
    });
    expect(syncedSnapshotDomainData).toEqual(replacedDomainData);
  });
});

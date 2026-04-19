import { describe, expect, it } from 'vitest';
import { appendPathValue, mergePathValue, readPath, removePathValue, writePathValue } from '@features/builder/store/path';

describe('path utilities', () => {
  it('rejects paths that contain __proto__ segments', () => {
    expect(() => readPath({}, 'app.__proto__.polluted')).toThrow('__proto__');
  });

  it('rejects paths that contain constructor segments', () => {
    expect(() => readPath({}, 'app.constructor.value')).toThrow('constructor');
  });

  it('rejects paths that contain prototype segments', () => {
    expect(() => readPath({}, 'app.prototype.value')).toThrow('prototype');
  });

  it('rejects empty write paths', () => {
    expect(() => writePathValue({}, '   ', 'Ada')).toThrow('non-empty dot-path');
  });

  it('removes only the requested item from a valid array path', () => {
    const state = {
      app: {
        tasks: ['first', 'second', 'third'],
      },
    };

    const nextState = removePathValue(state, 'app.tasks', 1);

    expect(nextState).toEqual({
      app: {
        tasks: ['first', 'third'],
      },
    });
  });

  it('ignores dangerous merge patch keys while applying safe fields', () => {
    const state = {
      app: {
        profile: {
          name: 'Ada',
          role: 'engineer',
        },
      },
    };
    const patch = JSON.parse('{"name":"Grace","__proto__":{"polluted":true},"constructor":{"danger":true}}') as Record<string, unknown>;

    const nextState = mergePathValue(state, 'app.profile', patch);
    const profile = readPath(nextState, 'app.profile');

    expect(profile).toEqual({
      name: 'Grace',
      role: 'engineer',
    });
    expect(Object.prototype.hasOwnProperty.call(profile as Record<string, unknown>, 'constructor')).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('appends to a valid array path', () => {
    const state = {
      app: {
        tasks: [{ title: 'Draft tests' }],
      },
    };

    const nextState = appendPathValue(state, 'app.tasks', { title: 'Ship fix' });

    expect(nextState).toEqual({
      app: {
        tasks: [{ title: 'Draft tests' }, { title: 'Ship fix' }],
      },
    });
  });
});

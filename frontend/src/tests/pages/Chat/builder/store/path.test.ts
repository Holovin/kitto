import { describe, expect, it } from 'vitest';
import {
  appendPathValue,
  clonePersistedDomainData,
  clonePersistedRuntimeState,
  mergePathValue,
  readPath,
  removePathValue,
  validatePersistedRuntimeStateTree,
  validatePersistedStateTree,
  writePathValue,
} from '@pages/Chat/builder/store/path';

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

  it('allows OpenUI runtime variable keys in persisted runtime state validation', () => {
    expect(
      validatePersistedRuntimeStateTree(
        {
          $currentScreen: 'details',
          $draft: {
            title: 'Ada',
          },
          $lastChoice: 'pro',
        },
        { label: 'builderSession.runtimeSessionState' },
      ),
    ).toBeNull();
  });

  it('keeps domain-state validation strict for $-prefixed keys', () => {
    expect(
      validatePersistedStateTree(
        {
          $draft: {
            title: 'Ada',
          },
        },
        { label: 'domain.data' },
      ),
    ).toContain('$draft');
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects forbidden keys in persisted runtime state validation: "%s"',
    (forbiddenKey) => {
      expect(
        validatePersistedRuntimeStateTree(
          JSON.parse(`{"${forbiddenKey}":{"polluted":true}}`) as unknown,
          { label: 'builderSession.runtimeSessionState' },
        ),
      ).toContain(forbiddenKey);
    },
  );

  it('clones persisted domain data while enforcing JSON-compatible values', () => {
    const source = {
      app: {
        tasks: ['Draft tests'],
      },
    };

    const cloned = clonePersistedDomainData(source);
    source.app.tasks.push('Ship fix');

    expect(cloned).toEqual({
      app: {
        tasks: ['Draft tests'],
      },
    });
    expect(() => clonePersistedDomainData({ app: { createdAt: new Date('2026-04-19T08:30:00.000Z') } })).toThrow(
      'Domain data.app.createdAt must be JSON-compatible plain data.',
    );
  });

  it('clones persisted runtime state while allowing OpenUI runtime variable keys', () => {
    const cloned = clonePersistedRuntimeState({
      $currentScreen: 'details',
      form: {
        title: 'Ada',
      },
    });

    expect(cloned).toEqual({
      $currentScreen: 'details',
      form: {
        title: 'Ada',
      },
    });
    expect(() => clonePersistedDomainData({ $currentScreen: 'details' })).toThrow(
      'Domain data contains the invalid key "$currentScreen".',
    );
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

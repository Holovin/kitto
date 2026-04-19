import { domainActions } from '@features/builder/store/domainSlice';
import { readPath } from '@features/builder/store/path';
import { store } from '@store/store';
import { getToolPathValue, getToolRecordValue } from './toolArguments';

function createBuilderToolProvider() {
  return {
    read_state: async (args: Record<string, unknown>) => {
      const path = getToolPathValue(args.path);
      const value = readPath(store.getState().domain.data, path);

      return structuredClone(value ?? null);
    },
    write_state: async (args: Record<string, unknown>) => {
      const path = getToolPathValue(args.path);
      store.dispatch(
        domainActions.writeState({
          path,
          value: args.value,
        }),
      );
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    merge_state: async (args: Record<string, unknown>) => {
      const path = getToolPathValue(args.path);
      const patch = getToolRecordValue(args.patch ?? args.value);
      store.dispatch(
        domainActions.mergeState({
          path,
          patch,
        }),
      );
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    append_state: async (args: Record<string, unknown>) => {
      const path = getToolPathValue(args.path);
      store.dispatch(
        domainActions.appendState({
          path,
          value: args.value,
        }),
      );
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    remove_state: async (args: Record<string, unknown>) => {
      const path = getToolPathValue(args.path);
      store.dispatch(
        domainActions.removeState({
          path,
          index: typeof args.index === 'number' ? args.index : 0,
        }),
      );
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
  };
}

export const builderToolProvider = createBuilderToolProvider();

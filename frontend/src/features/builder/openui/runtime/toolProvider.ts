import { domainActions } from '@features/builder/store/domainSlice';
import { readPath } from '@features/builder/store/path';
import { store } from '@store/store';
import { getRequiredToolIndex, getRequiredToolPatch, getRequiredToolPath, getRequiredToolValue, wrapToolError } from './toolArguments';

async function runTool<T>(toolName: string, callback: () => T | Promise<T>) {
  try {
    return await callback();
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

function createBuilderToolProvider() {
  return {
    read_state: async (args: Record<string, unknown>) => {
      return runTool('read_state', () => {
        const path = getRequiredToolPath('read_state', args.path);
        const value = readPath(store.getState().domain.data, path);

        return structuredClone(value ?? null);
      });
    },
    write_state: async (args: Record<string, unknown>) => {
      return runTool('write_state', () => {
        const path = getRequiredToolPath('write_state', args.path);
        const value = getRequiredToolValue('write_state', args.value);

        store.dispatch(
          domainActions.writeState({
            path,
            value,
          }),
        );
        return structuredClone(readPath(store.getState().domain.data, path) ?? null);
      });
    },
    merge_state: async (args: Record<string, unknown>) => {
      return runTool('merge_state', () => {
        const path = getRequiredToolPath('merge_state', args.path);
        const patch = getRequiredToolPatch('merge_state', args.patch ?? args.value);

        store.dispatch(
          domainActions.mergeState({
            path,
            patch,
          }),
        );
        return structuredClone(readPath(store.getState().domain.data, path) ?? null);
      });
    },
    append_state: async (args: Record<string, unknown>) => {
      return runTool('append_state', () => {
        const path = getRequiredToolPath('append_state', args.path);
        const value = getRequiredToolValue('append_state', args.value);

        store.dispatch(
          domainActions.appendState({
            path,
            value,
          }),
        );
        return structuredClone(readPath(store.getState().domain.data, path) ?? null);
      });
    },
    remove_state: async (args: Record<string, unknown>) => {
      return runTool('remove_state', () => {
        const path = getRequiredToolPath('remove_state', args.path);
        const index = getRequiredToolIndex('remove_state', args.index);

        store.dispatch(
          domainActions.removeState({
            path,
            index,
          }),
        );
        return structuredClone(readPath(store.getState().domain.data, path) ?? null);
      });
    },
  };
}

export const builderToolProvider = createBuilderToolProvider();

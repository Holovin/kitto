import { builderActions } from '@features/builder/store/builderSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { readPath } from '@features/builder/store/path';
import { store } from '@store/store';

function getPathValue(path: unknown) {
  return typeof path === 'string' ? path : '';
}

function getRecordValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function syncLatestSnapshot() {
  store.dispatch(
    builderActions.syncLatestSnapshot({
      domainData: store.getState().domain.data,
    }),
  );
}

export function createBuilderToolProvider() {
  return {
    read_state: async (args: Record<string, unknown>) => {
      const path = getPathValue(args.path);
      const value = readPath(store.getState().domain.data, path);

      return structuredClone(value ?? null);
    },
    write_state: async (args: Record<string, unknown>) => {
      const path = getPathValue(args.path);
      store.dispatch(
        domainActions.writeState({
          path,
          value: args.value,
        }),
      );
      syncLatestSnapshot();
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    merge_state: async (args: Record<string, unknown>) => {
      const path = getPathValue(args.path);
      const patch = getRecordValue(args.patch ?? args.value);
      store.dispatch(
        domainActions.mergeState({
          path,
          patch,
        }),
      );
      syncLatestSnapshot();
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    append_state: async (args: Record<string, unknown>) => {
      const path = getPathValue(args.path);
      store.dispatch(
        domainActions.appendState({
          path,
          value: args.value,
        }),
      );
      syncLatestSnapshot();
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    remove_state: async (args: Record<string, unknown>) => {
      const path = getPathValue(args.path);
      store.dispatch(
        domainActions.removeState({
          path,
          index: typeof args.index === 'number' ? args.index : 0,
        }),
      );
      syncLatestSnapshot();
      return structuredClone(readPath(store.getState().domain.data, path) ?? null);
    },
    open_url: async (args: Record<string, unknown>) => {
      const url = typeof args.url === 'string' ? args.url : '';

      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }

      return { opened: Boolean(url), url };
    },
    navigate_screen: async (args: Record<string, unknown>) => {
      const screenId = typeof args.screenId === 'string' ? args.screenId : '';

      store.dispatch(
        domainActions.writeState({
          path: 'navigation.currentScreenId',
          value: screenId,
        }),
      );
      syncLatestSnapshot();
      return { screenId };
    },
  };
}

export const builderToolProvider = createBuilderToolProvider();

import { appendPathValue, clonePlainObject, mergePathValue, readPath, removePathValue, writePathValue } from '@features/builder/store/path';
import { getRequiredToolIndex, getRequiredToolPatch, getRequiredToolPath, getRequiredToolValue, wrapToolError } from './toolArguments';

export type DomainToolAdapter = {
  readDomainData: () => Record<string, unknown>;
  replaceDomainData: (nextData: Record<string, unknown>) => void;
};

async function runTool<T>(toolName: string, callback: () => T | Promise<T>) {
  try {
    return await callback();
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

function readDomainSnapshot(adapter: DomainToolAdapter) {
  return clonePlainObject(adapter.readDomainData(), 'Domain data must be a plain object.');
}

export function createDomainToolProvider(adapter: DomainToolAdapter) {
  return {
    read_state: async (args: Record<string, unknown>) => {
      return runTool('read_state', () => {
        const path = getRequiredToolPath('read_state', args.path);
        return structuredClone(readPath(readDomainSnapshot(adapter), path) ?? null);
      });
    },
    write_state: async (args: Record<string, unknown>) => {
      return runTool('write_state', () => {
        const path = getRequiredToolPath('write_state', args.path);
        const value = getRequiredToolValue('write_state', args.value);
        const nextData = writePathValue(readDomainSnapshot(adapter), path, value);

        adapter.replaceDomainData(nextData);
        return structuredClone(readPath(nextData, path) ?? null);
      });
    },
    merge_state: async (args: Record<string, unknown>) => {
      return runTool('merge_state', () => {
        const path = getRequiredToolPath('merge_state', args.path);
        const patch = getRequiredToolPatch('merge_state', args.patch ?? args.value);
        const nextData = mergePathValue(readDomainSnapshot(adapter), path, patch);

        adapter.replaceDomainData(nextData);
        return structuredClone(readPath(nextData, path) ?? null);
      });
    },
    append_state: async (args: Record<string, unknown>) => {
      return runTool('append_state', () => {
        const path = getRequiredToolPath('append_state', args.path);
        const value = getRequiredToolValue('append_state', args.value);
        const nextData = appendPathValue(readDomainSnapshot(adapter), path, value);

        adapter.replaceDomainData(nextData);
        return structuredClone(readPath(nextData, path) ?? null);
      });
    },
    remove_state: async (args: Record<string, unknown>) => {
      return runTool('remove_state', () => {
        const path = getRequiredToolPath('remove_state', args.path);
        const index = getRequiredToolIndex('remove_state', args.index);
        const nextData = removePathValue(readDomainSnapshot(adapter), path, index);

        adapter.replaceDomainData(nextData);
        return structuredClone(readPath(nextData, path) ?? null);
      });
    },
  };
}

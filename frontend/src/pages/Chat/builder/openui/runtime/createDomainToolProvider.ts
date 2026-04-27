import { nanoid } from '@reduxjs/toolkit';
import {
  appendPathValue,
  cloneJsonCompatibleValue,
  clonePersistedDomainData,
  DomainStateError,
  isPlainObject,
  mergePathValue,
  readPath,
  removePathValue,
  writePathValue,
} from '@pages/Chat/builder/store/path';
import { computeValue, type ComputeValueInput } from './computeTools';
import {
  getOptionalToolComputeReturnType,
  getOptionalToolOptions,
  getOptionalToolValues,
  getRequiredToolComputeOp,
  getRequiredToolFieldName,
  getRequiredToolIndex,
  getRequiredToolItemId,
  getRequiredToolObject,
  getRequiredToolPatch,
  getRequiredToolPath,
  getRequiredToolValue,
  isValidToolItemId,
  type ToolItemId,
  wrapToolError,
} from './toolArguments';

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
  return clonePersistedDomainData(adapter.readDomainData());
}

function cloneToolResult(value: unknown) {
  return cloneJsonCompatibleValue(value ?? null);
}

function generateStableId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();

  return typeof randomUuid === 'string' && randomUuid.trim().length > 0 ? randomUuid : nanoid();
}

function collectExistingItemIds(items: unknown[]) {
  const existingIds = new Set<ToolItemId>();

  for (const item of items) {
    if (isPlainObject(item) && isValidToolItemId(item.id)) {
      existingIds.add(item.id);
    }
  }

  return existingIds;
}

function generateUniqueStableId(existingIds: ReadonlySet<ToolItemId>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidateId = generateStableId();

    if (!existingIds.has(candidateId)) {
      return candidateId;
    }
  }

  const fallbackBaseId = generateStableId();
  let fallbackSuffix = 1;
  let fallbackId = `${fallbackBaseId}-${fallbackSuffix}`;

  while (existingIds.has(fallbackId)) {
    fallbackSuffix += 1;
    fallbackId = `${fallbackBaseId}-${fallbackSuffix}`;
  }

  return fallbackId;
}

function resolveAppendItemId(items: unknown[], requestedId: unknown) {
  const existingIds = collectExistingItemIds(items);

  if (isValidToolItemId(requestedId) && !existingIds.has(requestedId)) {
    return requestedId;
  }

  return generateUniqueStableId(existingIds);
}

function readArrayOrEmpty(state: Record<string, unknown>, path: string) {
  const currentValue = readPath(state, path);

  if (currentValue == null) {
    return [];
  }

  if (!Array.isArray(currentValue)) {
    throw new DomainStateError(`State path "${path}" does not contain an array value.`);
  }

  return currentValue;
}

function readArrayOrThrow(state: Record<string, unknown>, path: string) {
  const currentValue = readPath(state, path);

  if (!Array.isArray(currentValue)) {
    throw new DomainStateError(`State path "${path}" does not contain an array value.`);
  }

  return currentValue;
}

function findMatchingItemIndex(items: unknown[], path: string, idField: string, id: ToolItemId) {
  const matchingIndex = items.findIndex((item) => isPlainObject(item) && item[idField] === id);

  if (matchingIndex === -1) {
    throw new DomainStateError(`State path "${path}" does not contain an item with ${idField}=${JSON.stringify(id)}.`);
  }

  return matchingIndex;
}

function getComputeToolInput(toolName: string, args: Record<string, unknown>): ComputeValueInput {
  return {
    op: getRequiredToolComputeOp(toolName, args.op),
    input: args.input,
    left: args.left,
    right: args.right,
    values: getOptionalToolValues(toolName, args.values),
    options: getOptionalToolOptions(toolName, args.options),
    returnType: getOptionalToolComputeReturnType(toolName, args.returnType),
  };
}

export function createDomainToolProvider(adapter: DomainToolAdapter) {
  return {
    read_state: async (args: Record<string, unknown>) => {
      return runTool('read_state', () => {
        const path = getRequiredToolPath('read_state', args.path);
        return cloneToolResult(readPath(readDomainSnapshot(adapter), path));
      });
    },
    write_state: async (args: Record<string, unknown>) => {
      return runTool('write_state', () => {
        const path = getRequiredToolPath('write_state', args.path);
        const value = getRequiredToolValue('write_state', args.value);
        const nextData = writePathValue(readDomainSnapshot(adapter), path, value);

        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    merge_state: async (args: Record<string, unknown>) => {
      return runTool('merge_state', () => {
        const path = getRequiredToolPath('merge_state', args.path);
        const patch = getRequiredToolPatch('merge_state', args.patch ?? args.value);
        const nextData = mergePathValue(readDomainSnapshot(adapter), path, patch);

        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    append_state: async (args: Record<string, unknown>) => {
      return runTool('append_state', () => {
        const path = getRequiredToolPath('append_state', args.path);
        const value = getRequiredToolValue('append_state', args.value);
        const nextData = appendPathValue(readDomainSnapshot(adapter), path, value);

        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    append_item: async (args: Record<string, unknown>) => {
      return runTool('append_item', () => {
        const path = getRequiredToolPath('append_item', args.path);
        const value = getRequiredToolObject('append_item', args.value);
        const nextData = readDomainSnapshot(adapter);
        const currentItems = readArrayOrEmpty(nextData, path);
        const itemId = resolveAppendItemId(currentItems, value.id);
        const nextItems = [...currentItems, { ...value, id: itemId }];

        writePathValue(nextData, path, nextItems);
        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    toggle_item_field: async (args: Record<string, unknown>) => {
      return runTool('toggle_item_field', () => {
        const path = getRequiredToolPath('toggle_item_field', args.path);
        const idField = getRequiredToolFieldName('toggle_item_field', args.idField, 'idField');
        const id = getRequiredToolItemId('toggle_item_field', args.id);
        const field = getRequiredToolFieldName('toggle_item_field', args.field, 'field');
        const nextData = readDomainSnapshot(adapter);
        const currentItems = readArrayOrThrow(nextData, path);
        const matchingIndex = findMatchingItemIndex(currentItems, path, idField, id);
        const matchingItem = currentItems[matchingIndex] as Record<string, unknown>;
        const nextItems = currentItems.map((item, index) =>
          index === matchingIndex ? { ...matchingItem, [field]: !matchingItem[field] } : item,
        );

        writePathValue(nextData, path, nextItems);
        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    update_item_field: async (args: Record<string, unknown>) => {
      return runTool('update_item_field', () => {
        const path = getRequiredToolPath('update_item_field', args.path);
        const idField = getRequiredToolFieldName('update_item_field', args.idField, 'idField');
        const id = getRequiredToolItemId('update_item_field', args.id);
        const field = getRequiredToolFieldName('update_item_field', args.field, 'field');
        const value = getRequiredToolValue('update_item_field', args.value);
        const nextData = readDomainSnapshot(adapter);
        const currentItems = readArrayOrThrow(nextData, path);
        const matchingIndex = findMatchingItemIndex(currentItems, path, idField, id);
        const matchingItem = currentItems[matchingIndex] as Record<string, unknown>;
        const nextItems = currentItems.map((item, index) =>
          index === matchingIndex ? { ...matchingItem, [field]: value } : item,
        );

        writePathValue(nextData, path, nextItems);
        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    remove_item: async (args: Record<string, unknown>) => {
      return runTool('remove_item', () => {
        const path = getRequiredToolPath('remove_item', args.path);
        const idField = getRequiredToolFieldName('remove_item', args.idField, 'idField');
        const id = getRequiredToolItemId('remove_item', args.id);
        const nextData = readDomainSnapshot(adapter);
        const currentItems = readArrayOrThrow(nextData, path);
        const matchingIndex = findMatchingItemIndex(currentItems, path, idField, id);
        const nextItems = currentItems.filter((_, index) => index !== matchingIndex);

        writePathValue(nextData, path, nextItems);
        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    remove_state: async (args: Record<string, unknown>) => {
      return runTool('remove_state', () => {
        const path = getRequiredToolPath('remove_state', args.path);
        const index = getRequiredToolIndex('remove_state', args.index);
        const nextData = removePathValue(readDomainSnapshot(adapter), path, index);

        adapter.replaceDomainData(nextData);
        return cloneToolResult(readPath(nextData, path));
      });
    },
    compute_value: async (args: Record<string, unknown>) => {
      return runTool('compute_value', () => computeValue(getComputeToolInput('compute_value', args)));
    },
    write_computed_state: async (args: Record<string, unknown>) => {
      return runTool('write_computed_state', () => {
        const path = getRequiredToolPath('write_computed_state', args.path);
        const computedValue = computeValue(getComputeToolInput('write_computed_state', args));
        const nextData = writePathValue(readDomainSnapshot(adapter), path, computedValue.value);

        adapter.replaceDomainData(nextData);
        return computedValue;
      });
    },
  };
}

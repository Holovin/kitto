import { cloneJsonCompatibleValue, clonePlainObject, DomainStateError, validateDomainFieldName, validateDomainPath } from '@features/builder/store/path';

function createToolError(toolName: string, message: string) {
  return new DomainStateError(`${toolName}: ${message}`);
}

export type ToolItemId = number | string;

export function wrapToolError(toolName: string, error: unknown): Error {
  if (error instanceof DomainStateError) {
    return error.message.startsWith(`${toolName}:`) ? error : createToolError(toolName, error.message);
  }

  if (error instanceof Error) {
    return createToolError(toolName, error.message);
  }

  return createToolError(toolName, 'Unexpected tool failure.');
}

export function getRequiredToolPath(toolName: string, path: unknown) {
  if (typeof path !== 'string') {
    throw createToolError(toolName, 'path must be a string.');
  }

  try {
    return validateDomainPath(path);
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

export function getRequiredToolValue(toolName: string, value: unknown) {
  if (value === undefined) {
    throw createToolError(toolName, 'value is required.');
  }

  try {
    return cloneJsonCompatibleValue(value);
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

export function getRequiredToolPatch(toolName: string, patch: unknown) {
  if (patch === undefined) {
    throw createToolError(toolName, 'patch must be a plain object.');
  }

  try {
    return clonePlainObject(patch, 'patch must be a plain object.');
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

export function getRequiredToolIndex(toolName: string, index: unknown) {
  if (!Number.isSafeInteger(index) || typeof index !== 'number' || index < 0) {
    throw createToolError(toolName, 'index must be a non-negative integer.');
  }

  return index;
}

export function getRequiredToolObject(toolName: string, value: unknown, argName = 'value') {
  if (value === undefined) {
    throw createToolError(toolName, `${argName} must be a plain object.`);
  }

  try {
    return clonePlainObject(value, `${argName} must be a plain object.`);
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

export function getRequiredToolFieldName(toolName: string, fieldName: unknown, argName = 'field') {
  if (typeof fieldName !== 'string') {
    throw createToolError(toolName, `${argName} must be a string.`);
  }

  try {
    return validateDomainFieldName(fieldName, argName);
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

export function isValidToolItemId(id: unknown): id is ToolItemId {
  if (typeof id === 'string') {
    return id.trim().length > 0;
  }

  return typeof id === 'number' && Number.isFinite(id);
}

export function getRequiredToolItemId(toolName: string, id: unknown) {
  if (!isValidToolItemId(id)) {
    throw createToolError(toolName, 'id must be a non-empty string or finite number.');
  }

  return id;
}

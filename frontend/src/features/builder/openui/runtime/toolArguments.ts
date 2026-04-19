import { cloneJsonCompatibleValue, clonePlainObject, DomainStateError, validateDomainPath } from '@features/builder/store/path';

function createToolError(toolName: string, message: string) {
  return new DomainStateError(`${toolName}: ${message}`);
}

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

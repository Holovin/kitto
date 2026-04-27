import { cloneJsonCompatibleValue, clonePlainObject, DomainStateError, validateDomainFieldName, validateDomainPath } from '@pages/Chat/builder/store/path';
import {
  OPENUI_COMPUTE_OPS,
  OPENUI_COMPUTE_RETURN_TYPES,
  type OpenUiComputeOp,
  type OpenUiComputeReturnType,
} from '@kitto-openui/shared/openuiToolRegistry.js';

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

function isOpenUiComputeOp(op: unknown): op is OpenUiComputeOp {
  return typeof op === 'string' && (OPENUI_COMPUTE_OPS as readonly string[]).includes(op);
}

function isOpenUiComputeReturnType(returnType: unknown): returnType is OpenUiComputeReturnType {
  return typeof returnType === 'string' && (OPENUI_COMPUTE_RETURN_TYPES as readonly string[]).includes(returnType);
}

export function getRequiredToolItemId(toolName: string, id: unknown) {
  if (!isValidToolItemId(id)) {
    throw createToolError(toolName, 'id must be a non-empty string or finite number.');
  }

  return id;
}

export function getRequiredToolComputeOp(toolName: string, op: unknown): OpenUiComputeOp {
  if (isOpenUiComputeOp(op)) {
    return op;
  }

  throw createToolError(toolName, `Unknown compute op "${String(op)}".`);
}

export function getOptionalToolValues(toolName: string, values: unknown): unknown[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  let clonedValues: unknown;

  try {
    clonedValues = cloneJsonCompatibleValue(values);
  } catch (error) {
    throw wrapToolError(toolName, error);
  }

  if (!Array.isArray(clonedValues)) {
    throw createToolError(toolName, 'values must be an array.');
  }

  return clonedValues;
}

export function getOptionalToolOptions(toolName: string, options: unknown): Record<string, unknown> | undefined {
  if (options === undefined) {
    return undefined;
  }

  try {
    return clonePlainObject(options, 'options must be a plain object.');
  } catch (error) {
    throw wrapToolError(toolName, error);
  }
}

export function getOptionalToolComputeReturnType(toolName: string, returnType: unknown): OpenUiComputeReturnType | undefined {
  if (returnType === undefined) {
    return undefined;
  }

  if (isOpenUiComputeReturnType(returnType)) {
    return returnType;
  }

  throw createToolError(toolName, `returnType must be one of ${OPENUI_COMPUTE_RETURN_TYPES.map((value) => `"${value}"`).join(', ')}.`);
}

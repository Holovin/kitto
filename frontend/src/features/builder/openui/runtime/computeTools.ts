import { cloneJsonCompatibleValue, clonePlainObject, DomainStateError } from '@features/builder/store/path';
import {
  OPENUI_COMPUTE_OPS,
  OPENUI_COMPUTE_RETURN_TYPES,
  type OpenUiComputeOp,
  type OpenUiComputeReturnType,
} from '@kitto-openui/shared/openuiToolRegistry.js';

const RANDOM_INT_RANGE_LIMIT = 1_000_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const COMPUTE_OPS = OPENUI_COMPUTE_OPS;
export const COMPUTE_RETURN_TYPES = OPENUI_COMPUTE_RETURN_TYPES;

export type ComputeOp = OpenUiComputeOp;
export type ComputeReturnType = OpenUiComputeReturnType;
export type ComputePrimitive = boolean | number | string;

export interface ComputeValueInput {
  op: ComputeOp;
  input?: unknown;
  left?: unknown;
  right?: unknown;
  values?: unknown[];
  options?: Record<string, unknown>;
  returnType?: ComputeReturnType;
}

export interface ComputeValueResult {
  value: ComputePrimitive;
}

const BOOLEAN_OPS = new Set<ComputeOp>([
  'truthy',
  'falsy',
  'not',
  'and',
  'or',
  'equals',
  'not_equals',
  'number_gt',
  'number_gte',
  'number_lt',
  'number_lte',
  'is_empty',
  'not_empty',
  'contains_text',
  'starts_with',
  'ends_with',
  'date_before',
  'date_after',
  'date_on_or_before',
  'date_on_or_after',
]);

const NUMBER_OPS = new Set<ComputeOp>(['to_number', 'add', 'subtract', 'multiply', 'divide', 'clamp', 'random_int']);
const STRING_OPS = new Set<ComputeOp>(['to_lower', 'to_upper', 'trim', 'today_date']);

function createComputeError(message: string) {
  return new DomainStateError(message);
}

function isComputeOp(value: unknown): value is ComputeOp {
  return typeof value === 'string' && COMPUTE_OPS.some((op) => op === value);
}

function getComputeOp(op: unknown) {
  if (!isComputeOp(op)) {
    throw createComputeError(`Unknown compute op "${String(op)}".`);
  }

  return op;
}

function getReturnType(returnType: unknown) {
  if (returnType === undefined) {
    return undefined;
  }

  if (returnType === 'string' || returnType === 'number' || returnType === 'boolean') {
    return returnType;
  }

  throw createComputeError(`returnType must be one of ${COMPUTE_RETURN_TYPES.map((value) => `"${value}"`).join(', ')}.`);
}

function getSafeValues(values: unknown) {
  if (values === undefined) {
    return undefined;
  }

  const clonedValues = cloneJsonCompatibleValue(values);

  if (!Array.isArray(clonedValues)) {
    throw createComputeError('values must be an array.');
  }

  return clonedValues;
}

function getSafeOptions(options: unknown) {
  if (options === undefined) {
    return {};
  }

  return clonePlainObject(options, 'options must be a plain object.');
}

function getExpectedReturnType(op: ComputeOp): ComputeReturnType {
  if (BOOLEAN_OPS.has(op)) {
    return 'boolean';
  }

  if (NUMBER_OPS.has(op)) {
    return 'number';
  }

  if (STRING_OPS.has(op)) {
    return 'string';
  }

  throw createComputeError(`No return type mapping exists for op "${op}".`);
}

function parseFiniteNumber(value: unknown, label: string) {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value;
    }

    throw createComputeError(`${label} must be a finite number or numeric string.`);
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      throw createComputeError(`${label} must be a finite number or numeric string.`);
    }

    const parsedValue = Number(trimmedValue);

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  throw createComputeError(`${label} must be a finite number or numeric string.`);
}

function parseIntegerOption(value: unknown, label: string) {
  const parsedValue = parseFiniteNumber(value, label);

  if (!Number.isInteger(parsedValue)) {
    throw createComputeError(`${label} must be an integer.`);
  }

  return parsedValue;
}

function getStringInput(input: unknown) {
  return String(input ?? '');
}

function getStringQuery(options: Record<string, unknown>, right: unknown) {
  if (options.regex !== undefined || options.pattern !== undefined) {
    throw createComputeError('Regular expressions are not supported.');
  }

  const query = options.query ?? right;

  if (typeof query !== 'string') {
    throw createComputeError('options.query must be a string.');
  }

  return query;
}

function normalizePrimitiveForEquality(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    const lowerValue = trimmedValue.toLowerCase();

    if (lowerValue === 'true') {
      return true;
    }

    if (lowerValue === 'false') {
      return false;
    }

    if (trimmedValue !== '') {
      const parsedNumber = Number(trimmedValue);

      if (Number.isFinite(parsedNumber)) {
        return parsedNumber;
      }
    }

    return value;
  }

  return value;
}

function compareEquality(left: unknown, right: unknown) {
  const normalizedLeft = normalizePrimitiveForEquality(left);
  const normalizedRight = normalizePrimitiveForEquality(right);

  if (
    (normalizedLeft && typeof normalizedLeft === 'object') ||
    (normalizedRight && typeof normalizedRight === 'object') ||
    typeof normalizedLeft === 'function' ||
    typeof normalizedRight === 'function'
  ) {
    return Object.is(left, right);
  }

  return Object.is(normalizedLeft, normalizedRight);
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number) {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function parseIsoDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    throw createComputeError(`${label} must be a YYYY-MM-DD date string.`);
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw createComputeError(`${label} must be a valid calendar date.`);
  }

  if (month < 1 || month > 12) {
    throw createComputeError(`${label} must be a valid calendar date.`);
  }

  const maxDay = getDaysInMonth(year, month);

  if (day < 1 || day > maxDay) {
    throw createComputeError(`${label} must be a valid calendar date.`);
  }

  return value;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function assertPrimitiveResult(value: unknown, label = 'Computed value'): ComputePrimitive {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  throw createComputeError(`${label} must be a primitive string, number, or boolean.`);
}

function convertResultToReturnType(value: ComputePrimitive, returnType: ComputeReturnType): ComputePrimitive {
  switch (returnType) {
    case 'string':
      return String(value);
    case 'number':
      if (typeof value === 'number') {
        return value;
      }

      if (typeof value === 'string') {
        return parseFiniteNumber(value, 'Computed string result');
      }

      throw createComputeError('Computed boolean result cannot be converted to number safely.');
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }

      if (value === 'true') {
        return true;
      }

      if (value === 'false') {
        return false;
      }

      throw createComputeError('Computed result cannot be converted to boolean safely.');
  }
}

function finalizeResult(op: ComputeOp, rawValue: unknown, returnType: ComputeReturnType | undefined): ComputeValueResult {
  const primitiveValue = assertPrimitiveResult(rawValue);

  if (!returnType) {
    const expectedReturnType = getExpectedReturnType(op);

    if (expectedReturnType === 'boolean' && typeof primitiveValue !== 'boolean') {
      throw createComputeError(`Op "${op}" must return a boolean.`);
    }

    if (expectedReturnType === 'number' && typeof primitiveValue !== 'number') {
      throw createComputeError(`Op "${op}" must return a number.`);
    }

    if (expectedReturnType === 'string' && typeof primitiveValue !== 'string') {
      throw createComputeError(`Op "${op}" must return a string.`);
    }

    return { value: primitiveValue };
  }

  return {
    value: convertResultToReturnType(primitiveValue, returnType),
  };
}

export function computeValue(rawInput: ComputeValueInput): ComputeValueResult {
  const op = getComputeOp(rawInput.op);
  const values = getSafeValues(rawInput.values);
  const options = getSafeOptions(rawInput.options);
  const returnType = getReturnType(rawInput.returnType);

  switch (op) {
    case 'truthy':
      return finalizeResult(op, Boolean(rawInput.input), returnType);
    case 'falsy':
    case 'not':
      return finalizeResult(op, !rawInput.input, returnType);
    case 'and':
      if (!values) {
        throw createComputeError('values must be an array.');
      }

      return finalizeResult(op, values.every((value) => Boolean(value)), returnType);
    case 'or':
      if (!values) {
        throw createComputeError('values must be an array.');
      }

      return finalizeResult(op, values.some((value) => Boolean(value)), returnType);
    case 'equals':
      return finalizeResult(op, compareEquality(rawInput.left, rawInput.right), returnType);
    case 'not_equals':
      return finalizeResult(op, !compareEquality(rawInput.left, rawInput.right), returnType);
    case 'number_gt':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') > parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'number_gte':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') >= parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'number_lt':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') < parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'number_lte':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') <= parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'is_empty':
      return finalizeResult(op, getStringInput(rawInput.input).length === 0, returnType);
    case 'not_empty':
      return finalizeResult(op, getStringInput(rawInput.input).length > 0, returnType);
    case 'contains_text':
      return finalizeResult(op, getStringInput(rawInput.input).includes(getStringQuery(options, rawInput.right)), returnType);
    case 'starts_with':
      return finalizeResult(op, getStringInput(rawInput.input).startsWith(getStringQuery(options, rawInput.right)), returnType);
    case 'ends_with':
      return finalizeResult(op, getStringInput(rawInput.input).endsWith(getStringQuery(options, rawInput.right)), returnType);
    case 'to_lower':
      return finalizeResult(op, getStringInput(rawInput.input).toLowerCase(), returnType);
    case 'to_upper':
      return finalizeResult(op, getStringInput(rawInput.input).toUpperCase(), returnType);
    case 'trim':
      return finalizeResult(op, getStringInput(rawInput.input).trim(), returnType);
    case 'to_number':
      return finalizeResult(op, parseFiniteNumber(rawInput.input, 'input'), returnType);
    case 'add':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') + parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'subtract':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') - parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'multiply':
      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') * parseFiniteNumber(rawInput.right, 'right'), returnType);
    case 'divide': {
      const divisor = parseFiniteNumber(rawInput.right, 'right');

      if (divisor === 0) {
        throw createComputeError('Cannot divide by zero.');
      }

      return finalizeResult(op, parseFiniteNumber(rawInput.left, 'left') / divisor, returnType);
    }
    case 'clamp': {
      const min = parseFiniteNumber(options.min, 'options.min');
      const max = parseFiniteNumber(options.max, 'options.max');

      if (min > max) {
        throw createComputeError('options.min must be less than or equal to options.max.');
      }

      const value = parseFiniteNumber(rawInput.input, 'input');

      return finalizeResult(op, Math.min(Math.max(value, min), max), returnType);
    }
    case 'random_int': {
      const rawMin = options.min === undefined ? 0 : parseIntegerOption(options.min, 'options.min');
      const rawMax = options.max === undefined ? 100 : parseIntegerOption(options.max, 'options.max');

      if (rawMin > rawMax) {
        throw createComputeError('options.min must be less than or equal to options.max.');
      }

      const min = Math.max(-RANDOM_INT_RANGE_LIMIT, rawMin);
      const max = Math.min(RANDOM_INT_RANGE_LIMIT, rawMax);
      const randomValue = Math.floor(Math.random() * (max - min + 1)) + min;

      return finalizeResult(op, randomValue, returnType);
    }
    case 'today_date':
      return finalizeResult(op, formatLocalDate(new Date()), returnType);
    case 'date_before':
      return finalizeResult(op, parseIsoDate(rawInput.left, 'left') < parseIsoDate(rawInput.right, 'right'), returnType);
    case 'date_after':
      return finalizeResult(op, parseIsoDate(rawInput.left, 'left') > parseIsoDate(rawInput.right, 'right'), returnType);
    case 'date_on_or_before':
      return finalizeResult(op, parseIsoDate(rawInput.left, 'left') <= parseIsoDate(rawInput.right, 'right'), returnType);
    case 'date_on_or_after':
      return finalizeResult(op, parseIsoDate(rawInput.left, 'left') >= parseIsoDate(rawInput.right, 'right'), returnType);
  }
}

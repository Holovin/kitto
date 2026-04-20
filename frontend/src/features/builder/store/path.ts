const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const INDEX_SEGMENT_PATTERN = /^\d+$/;

export const MAX_DOMAIN_PATH_DEPTH = 10;

export class DomainStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainStateError';
  }
}

function createPlainObject() {
  return Object.create(Object.prototype) as Record<string, unknown>;
}

function createPathError(message: string) {
  return new DomainStateError(message);
}

function isIndexSegment(segment: string) {
  return INDEX_SEGMENT_PATTERN.test(segment);
}

function parseArrayIndex(segment: string, path: string) {
  if (!isIndexSegment(segment)) {
    throw createPathError(`State path "${path}" must use numeric array indexes.`);
  }

  const index = Number(segment);

  if (!Number.isSafeInteger(index) || index < 0) {
    throw createPathError(`State path "${path}" contains an invalid array index "${segment}".`);
  }

  return index;
}

function assertObjectSegment(segment: string, path: string) {
  if (isIndexSegment(segment)) {
    throw createPathError(`State path "${path}" can only use numeric segments for arrays.`);
  }
}

function getPathPrefix(segments: string[], index: number) {
  return segments.slice(0, index + 1).join('.');
}

function getSegments(path: string, options: { allowEmpty?: boolean } = {}) {
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    if (options.allowEmpty) {
      return [];
    }

    throw createPathError('State path must be a non-empty dot-path.');
  }

  const segments = trimmedPath.split('.').map((segment) => segment.trim());

  if (segments.some((segment) => segment.length === 0)) {
    throw createPathError(`State path "${path}" contains an empty segment.`);
  }

  if (segments.length > MAX_DOMAIN_PATH_DEPTH) {
    throw createPathError(`State path "${path}" exceeds the maximum depth of ${MAX_DOMAIN_PATH_DEPTH}.`);
  }

  for (const segment of segments) {
    if (!PATH_SEGMENT_PATTERN.test(segment)) {
      throw createPathError(`State path "${path}" contains an invalid segment "${segment}".`);
    }

    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw createPathError(`State path "${path}" contains the forbidden segment "${segment}".`);
    }
  }

  return segments;
}

export function validateDomainPath(path: string, options: { allowEmpty?: boolean } = {}) {
  return getSegments(path, options).join('.');
}

export function validateDomainFieldName(fieldName: string, label = 'Field name') {
  const trimmedFieldName = fieldName.trim();

  if (!trimmedFieldName) {
    throw createPathError(`${label} must be a non-empty field name.`);
  }

  if (trimmedFieldName.includes('.')) {
    throw createPathError(`${label} "${fieldName}" must not contain dots.`);
  }

  if (!PATH_SEGMENT_PATTERN.test(trimmedFieldName)) {
    throw createPathError(`${label} "${fieldName}" contains an invalid segment "${trimmedFieldName}".`);
  }

  if (FORBIDDEN_PATH_SEGMENTS.has(trimmedFieldName)) {
    throw createPathError(`${label} "${fieldName}" contains the forbidden segment "${trimmedFieldName}".`);
  }

  return trimmedFieldName;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function cloneJsonCompatibleValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DomainStateError('Tool values must be JSON-compatible.');
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonCompatibleValue(item));
  }

  if (isPlainObject(value)) {
    const nextObject = createPlainObject();

    for (const [key, nestedValue] of Object.entries(value)) {
      if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
        continue;
      }

      nextObject[key] = cloneJsonCompatibleValue(nestedValue);
    }

    return nextObject;
  }

  throw new DomainStateError('Tool values must be JSON-compatible.');
}

export function clonePlainObject(
  value: unknown,
  errorMessage = 'Expected a plain object.',
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new DomainStateError(errorMessage);
  }

  return cloneJsonCompatibleValue(value) as Record<string, unknown>;
}

function readValidatedPath(source: unknown, segments: string[], path: string) {
  return segments.reduce<unknown>((currentValue, segment) => {
    if (currentValue == null) {
      return undefined;
    }

    if (Array.isArray(currentValue)) {
      return currentValue[parseArrayIndex(segment, path)];
    }

    if (isPlainObject(currentValue)) {
      assertObjectSegment(segment, path);
      return currentValue[segment];
    }

    return undefined;
  }, source);
}

export function readPath(source: unknown, path: string) {
  const segments = getSegments(path, { allowEmpty: true });

  if (segments.length === 0) {
    return source;
  }

  return readValidatedPath(source, segments, path);
}

function ensureParent(target: Record<string, unknown>, path: string) {
  const segments = getSegments(path);

  let currentValue: Record<string, unknown> | unknown[] = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const nextContainer = isIndexSegment(nextSegment) ? [] : createPlainObject();
    const currentPrefix = getPathPrefix(segments, index);

    if (Array.isArray(currentValue)) {
      const currentIndex = parseArrayIndex(segment, path);
      const nestedValue: unknown = currentValue[currentIndex];

      if (nestedValue == null) {
        currentValue[currentIndex] = nextContainer;
        currentValue = currentValue[currentIndex] as Record<string, unknown> | unknown[];
        continue;
      }

      if (Array.isArray(nextContainer)) {
        if (!Array.isArray(nestedValue)) {
          throw createPathError(`State path "${path}" expects "${currentPrefix}" to be an array.`);
        }

        currentValue = nestedValue;
        continue;
      }

      if (!isPlainObject(nestedValue)) {
        throw createPathError(`State path "${path}" expects "${currentPrefix}" to be an object.`);
      }

      currentValue = nestedValue;
      continue;
    }

    assertObjectSegment(segment, path);

    const nestedValue: unknown = currentValue[segment];

    if (nestedValue == null) {
      currentValue[segment] = nextContainer;
      currentValue = currentValue[segment] as Record<string, unknown> | unknown[];
      continue;
    }

    if (Array.isArray(nextContainer)) {
      if (!Array.isArray(nestedValue)) {
        throw createPathError(`State path "${path}" expects "${currentPrefix}" to be an array.`);
      }

      currentValue = nestedValue;
      continue;
    }

    if (!isPlainObject(nestedValue)) {
      throw createPathError(`State path "${path}" expects "${currentPrefix}" to be an object.`);
    }

    currentValue = nestedValue;
  }

  return {
    key: segments.at(-1) ?? '',
    parent: currentValue,
  };
}

export function writePathValue(target: Record<string, unknown>, path: string, value: unknown) {
  const sanitizedValue = cloneJsonCompatibleValue(value);
  const { key, parent } = ensureParent(target, path);

  if (Array.isArray(parent)) {
    parent[parseArrayIndex(key, path)] = sanitizedValue;
    return target;
  }

  assertObjectSegment(key, path);
  parent[key] = sanitizedValue;
  return target;
}

export function mergePathValue(target: Record<string, unknown>, path: string, patch: Record<string, unknown>) {
  const currentValue = readPath(target, path);
  const safePatch = clonePlainObject(patch, 'merge_state patch must be a plain object.');
  const mergedValue = currentValue == null ? createPlainObject() : clonePlainObject(currentValue, `State path "${path}" does not contain an object value.`);

  for (const [key, value] of Object.entries(safePatch)) {
    mergedValue[key] = value;
  }

  return writePathValue(target, path, mergedValue);
}

export function appendPathValue(target: Record<string, unknown>, path: string, value: unknown) {
  const currentValue = readPath(target, path);
  const sanitizedValue = cloneJsonCompatibleValue(value);
  const nextArray = currentValue == null ? [] : Array.isArray(currentValue) ? [...currentValue] : null;

  if (!nextArray) {
    throw new DomainStateError(`State path "${path}" does not contain an array value.`);
  }

  nextArray.push(sanitizedValue);
  return writePathValue(target, path, nextArray);
}

export function removePathValue(target: Record<string, unknown>, path: string, index: number) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new DomainStateError('remove_state index must be a non-negative integer.');
  }

  const currentValue = readPath(target, path);

  if (!Array.isArray(currentValue)) {
    throw new DomainStateError(`State path "${path}" does not contain an array value.`);
  }

  if (index >= currentValue.length) {
    throw new DomainStateError(`remove_state index ${index} is out of bounds for "${path}".`);
  }

  return writePathValue(
    target,
    path,
    currentValue.filter((_, currentIndex) => currentIndex !== index),
  );
}

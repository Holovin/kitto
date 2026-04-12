function getSegments(path: string) {
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isIndexSegment(segment: string) {
  return /^\d+$/.test(segment);
}

function cloneObjectValue(value: unknown) {
  if (Array.isArray(value)) {
    return [...value];
  }

  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) };
  }

  return {};
}

export function readPath(source: unknown, path: string) {
  if (!path.trim()) {
    return source;
  }

  return getSegments(path).reduce<unknown>((currentValue, segment) => {
    if (currentValue == null) {
      return undefined;
    }

    if (Array.isArray(currentValue)) {
      return currentValue[Number(segment)];
    }

    if (typeof currentValue === 'object') {
      return (currentValue as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);
}

function ensureParent(target: Record<string, unknown>, path: string) {
  const segments = getSegments(path);

  if (segments.length === 0) {
    return { key: '', parent: target };
  }

  let currentValue: Record<string, unknown> | unknown[] = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const nextContainer = isIndexSegment(nextSegment) ? [] : {};

    if (Array.isArray(currentValue)) {
      const currentIndex = Number(segment);

      if (currentValue[currentIndex] == null || typeof currentValue[currentIndex] !== 'object') {
        currentValue[currentIndex] = nextContainer;
      }

      currentValue = currentValue[currentIndex] as Record<string, unknown> | unknown[];
      continue;
    }

    if (currentValue[segment] == null || typeof currentValue[segment] !== 'object') {
      currentValue[segment] = nextContainer;
    }

    currentValue = currentValue[segment] as Record<string, unknown> | unknown[];
  }

  return {
    key: segments.at(-1) ?? '',
    parent: currentValue,
  };
}

export function writePathValue(target: Record<string, unknown>, path: string, value: unknown) {
  if (!path.trim()) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }

  const { key, parent } = ensureParent(target, path);

  if (Array.isArray(parent)) {
    parent[Number(key)] = value;
    return target;
  }

  parent[key] = value;
  return target;
}

export function mergePathValue(target: Record<string, unknown>, path: string, patch: Record<string, unknown>) {
  const currentValue = readPath(target, path);
  const mergedValue = {
    ...(cloneObjectValue(currentValue) as Record<string, unknown>),
    ...patch,
  };

  return writePathValue(target, path, mergedValue);
}

export function appendPathValue(target: Record<string, unknown>, path: string, value: unknown) {
  const currentValue = readPath(target, path);
  const nextArray = Array.isArray(currentValue) ? [...currentValue, value] : [value];

  return writePathValue(target, path, nextArray);
}

export function removePathValue(target: Record<string, unknown>, path: string, index: number) {
  const currentValue = readPath(target, path);
  const nextArray = Array.isArray(currentValue) ? currentValue.filter((_, currentIndex) => currentIndex !== index) : [];

  return writePathValue(target, path, nextArray);
}

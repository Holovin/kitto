export function normalizeHeaderValue(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
}

export function parsePositiveIntegerHeader(value: string | null | undefined) {
  const normalizedValue = normalizeHeaderValue(value);

  if (!normalizedValue || !/^[1-9]\d*$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);
  return Number.isSafeInteger(parsedValue) ? parsedValue : null;
}

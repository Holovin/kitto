export function getToolPathValue(path: unknown) {
  return typeof path === 'string' ? path : '';
}

export function getToolRecordValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

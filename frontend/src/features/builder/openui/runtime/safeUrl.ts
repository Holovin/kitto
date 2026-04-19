const SAFE_ABSOLUTE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:']);
const SAFE_RELATIVE_BASE_URL = 'https://openui.local';

export function parseSafeUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue || /\s/.test(trimmedValue)) {
    return null;
  }

  if (trimmedValue.startsWith('/')) {
    if (trimmedValue.startsWith('//')) {
      return null;
    }

    try {
      new URL(trimmedValue, SAFE_RELATIVE_BASE_URL);
      return trimmedValue;
    } catch {
      return null;
    }
  }

  if (trimmedValue.startsWith('#')) {
    try {
      new URL(trimmedValue, SAFE_RELATIVE_BASE_URL);
      return trimmedValue;
    } catch {
      return null;
    }
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (!SAFE_ABSOLUTE_PROTOCOLS.has(parsedUrl.protocol)) {
      return null;
    }

    return trimmedValue;
  } catch {
    return null;
  }
}

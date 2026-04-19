const SAFE_ABSOLUTE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:']);
const SAFE_RELATIVE_BASE_URL = 'https://openui.local';

export type SafeUrlOpener = (url: string) => void;

function isFileProtocolRuntime() {
  return globalThis.location?.protocol === 'file:';
}

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

    // Standalone exports are opened from file:// without an app router,
    // so root-relative paths would resolve to local filesystem locations.
    if (isFileProtocolRuntime()) {
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
    // Standalone exports opened from file:// cannot safely navigate to
    // hash/self URLs in a new browsing context without noisy browser warnings.
    if (isFileProtocolRuntime()) {
      return null;
    }

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

function openSafeUrlInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openSafeUrl(value: unknown, opener: SafeUrlOpener = openSafeUrlInNewTab) {
  const safeUrl = parseSafeUrl(value);

  if (!safeUrl) {
    return false;
  }

  opener(safeUrl);
  return true;
}

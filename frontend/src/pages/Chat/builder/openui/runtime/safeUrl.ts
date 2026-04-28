const SAFE_ABSOLUTE_PROTOCOLS = new Set(['https:', 'http:']);
const SAFE_ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

export type SafeUrlOpener = (url: string) => void;

export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();

  if (value !== trimmedValue || !trimmedValue || /\s/.test(trimmedValue)) {
    return null;
  }

  if (!SAFE_ABSOLUTE_URL_PATTERN.test(trimmedValue)) {
    return null;
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

export function parseSafeUrl(value: unknown): string | null {
  return safeUrl(value);
}

export function parseSafeSourceUrlLiteral(value: unknown): string | null {
  return safeUrl(value);
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

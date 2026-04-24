import type { Context } from 'hono';

function normalizeRequestId(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
}

export function createRequestId() {
  return crypto.randomUUID();
}

export function getClientProvidedRequestIdFromContext(context: Context) {
  return normalizeRequestId(context.req.header('x-kitto-request-id'));
}

export function getRequestIdFromContext(context: Context) {
  return getClientProvidedRequestIdFromContext(context) ?? createRequestId();
}

export function getRequestBytesFromContext(context: Context) {
  const contentLength = context.req.header('content-length');

  if (!contentLength) {
    return null;
  }

  const parsedBytes = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsedBytes) && parsedBytes >= 0 ? parsedBytes : null;
}

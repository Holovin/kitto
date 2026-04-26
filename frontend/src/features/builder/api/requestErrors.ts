import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { isRecord } from '@features/builder/objectGuards';

type BuilderPublicErrorCode = 'internal_error' | 'timeout_error' | 'upstream_error' | 'validation_error';

interface NormalizedBuilderError {
  code?: BuilderPublicErrorCode;
  message: string;
  status?: number;
}

class BuilderRequestError extends Error {
  readonly code?: BuilderPublicErrorCode;
  readonly status?: number;

  constructor(message: string, options?: { code?: BuilderPublicErrorCode; status?: number }) {
    super(message);
    this.name = 'BuilderRequestError';
    this.code = options?.code;
    this.status = options?.status;
  }
}

function parseBuilderPublicErrorPayload(value: unknown): NormalizedBuilderError | null {
  if (typeof value === 'string') {
    try {
      return parseBuilderPublicErrorPayload(JSON.parse(value));
    } catch {
      return value.trim() ? { message: value } : null;
    }
  }

  if (!isRecord(value)) {
    return null;
  }

  const message =
    typeof value.error === 'string'
      ? value.error
      : typeof value.message === 'string'
        ? value.message
        : undefined;
  const code = typeof value.code === 'string' ? (value.code as BuilderPublicErrorCode) : undefined;
  const status = typeof value.status === 'number' ? value.status : undefined;

  if (!message && !code && status === undefined) {
    return null;
  }

  return {
    code,
    message: message ?? 'The request failed before the builder received a valid response.',
    status,
  };
}

function isFetchBaseQueryError(error: unknown): error is FetchBaseQueryError {
  return isRecord(error) && 'status' in error;
}

function isSerializedError(error: unknown): error is SerializedError {
  return isRecord(error) && ('message' in error || 'name' in error || 'stack' in error);
}

function normalizeBuilderError(error: unknown): NormalizedBuilderError {
  if (error instanceof BuilderRequestError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  const payloadError = parseBuilderPublicErrorPayload(error);

  if (payloadError) {
    return payloadError;
  }

  if (isFetchBaseQueryError(error)) {
    if (typeof error.status === 'number') {
      const parsedPayload = parseBuilderPublicErrorPayload(error.data);

      return {
        code: parsedPayload?.code,
        message: parsedPayload?.message ?? `Request failed with status ${error.status}.`,
        status: error.status,
      };
    }

    if (error.status === 'FETCH_ERROR') {
      return {
        message: 'The builder could not reach the backend service.',
      };
    }

    if (error.status === 'PARSING_ERROR') {
      return {
        message: 'The backend returned a response the builder could not read.',
      };
    }

    return {
      message: error.error || 'The request failed before the builder received a valid response.',
    };
  }

  if (isSerializedError(error) && typeof error.message === 'string' && error.message.trim()) {
    return {
      message: error.message,
    };
  }

  if (error instanceof Error && error.message.trim()) {
    return {
      message: error.message,
    };
  }

  return {
    message: 'The request failed before the builder received a valid response.',
  };
}

export function createBuilderRequestError(value: unknown, fallback: { message: string; status?: number }) {
  const parsed = parseBuilderPublicErrorPayload(value);

  return new BuilderRequestError(parsed?.message ?? fallback.message, {
    code: parsed?.code,
    status: parsed?.status ?? fallback.status,
  });
}

export async function createBuilderResponseError(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return createBuilderRequestError(await response.json(), {
      message: `Request failed with status ${response.status}.`,
      status: response.status,
    });
  }

  return createBuilderRequestError(await response.text(), {
    message: `Request failed with status ${response.status}.`,
    status: response.status,
  });
}

export function getBuilderRequestErrorMessage(error: unknown) {
  const normalized = normalizeBuilderError(error);

  if (normalized.status === 413) {
    return 'The request is too large to send as-is. Shorten the prompt or trim the chat history and try again.';
  }

  if (normalized.code === 'validation_error' || normalized.status === 400) {
    return 'The builder could not send that request. Review the prompt and try again.';
  }

  if (normalized.code === 'timeout_error' || normalized.status === 504) {
    return 'The model took too long to respond. Try again with a shorter or more specific prompt.';
  }

  if (normalized.code === 'upstream_error' || normalized.status === 502) {
    return 'The model service failed while generating the draft. Please retry in a moment.';
  }

  if (normalized.status === 401 || normalized.status === 403) {
    return 'The backend is not authorized to call the model service right now.';
  }

  if (normalized.code === 'internal_error' || normalized.status === 500) {
    return 'The backend hit an internal error while generating your app. Please try again.';
  }

  if (normalized.message === 'Streaming response body is not available.') {
    return 'The backend accepted the request, but the stream never opened. Please try again.';
  }

  if (normalized.message === 'Received a malformed "done" event from the backend stream.') {
    return 'The generation stream finished in an unreadable state. Please try again.';
  }

  if (normalized.message === 'The model stream ended before it returned any OpenUI source.') {
    return 'The model stopped before it returned a usable draft. Please try again.';
  }

  if (
    normalized.message === 'The builder could not reach the backend service.' ||
    normalized.message.includes('Failed to fetch') ||
    normalized.message.includes('NetworkError')
  ) {
    return 'The builder could not reach the backend. Check that the server is running and try again.';
  }

  return normalized.message;
}

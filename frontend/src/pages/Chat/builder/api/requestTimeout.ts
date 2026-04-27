import { createBuilderRequestError } from '@pages/Chat/builder/api/requestErrors';

export interface AbortableRequest<T> {
  abort: () => void;
  unwrap: () => Promise<T>;
}

function createRequestTimeoutError() {
  return createBuilderRequestError(
    {
      code: 'timeout_error',
      error: 'The model request timed out.',
      status: 504,
    },
    {
      message: 'The model request timed out.',
      status: 504,
    },
  );
}

export async function unwrapAbortableRequestWithTimeout<T>(request: AbortableRequest<T>, timeoutMs: number) {
  if (timeoutMs <= 0) {
    return request.unwrap();
  }

  let didTimeout = false;
  let isSettled = false;
  const timeoutId = setTimeout(() => {
    if (isSettled) {
      return;
    }

    didTimeout = true;
    request.abort();
  }, timeoutMs);

  try {
    return await request.unwrap();
  } catch (error) {
    if (didTimeout) {
      throw createRequestTimeoutError();
    }

    throw error;
  } finally {
    isSettled = true;
    clearTimeout(timeoutId);
  }
}

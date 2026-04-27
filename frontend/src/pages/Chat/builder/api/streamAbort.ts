export function createAbortError() {
  try {
    return new DOMException('This operation was aborted', 'AbortError');
  } catch {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    return error;
  }
}

export function createLinkedAbortController(signal?: AbortSignal) {
  const abortController = new AbortController();
  const handleAbort = () => abortController.abort();

  if (signal?.aborted) {
    handleAbort();
  } else {
    signal?.addEventListener('abort', handleAbort, { once: true });
  }

  return {
    abortController,
    cleanup() {
      signal?.removeEventListener('abort', handleAbort);
    },
  };
}

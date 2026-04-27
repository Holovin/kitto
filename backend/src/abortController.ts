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

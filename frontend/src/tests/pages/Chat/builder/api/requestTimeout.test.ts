import { describe, expect, it, vi } from 'vitest';
import { unwrapAbortableRequestWithTimeout, type AbortableRequest } from '@pages/Chat/builder/api/requestTimeout';

function createAbortableRequest<T>(unwrap: AbortableRequest<T>['unwrap']) {
  return {
    abort: vi.fn(),
    unwrap,
  } satisfies AbortableRequest<T>;
}

describe('unwrapAbortableRequestWithTimeout', () => {
  it('returns the request result when it resolves before the timeout', async () => {
    vi.useFakeTimers();
    const request = createAbortableRequest(async () => 'ok');

    await expect(unwrapAbortableRequestWithTimeout(request, 5_000)).resolves.toBe('ok');

    expect(request.abort).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('aborts the request and throws a normalized timeout error when it exceeds the timeout', async () => {
    vi.useFakeTimers();
    const request = createAbortableRequest<string>(
      () =>
        new Promise((_resolve, reject) => {
          request.abort.mockImplementation(() => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );

    const promise = unwrapAbortableRequestWithTimeout(request, 30_000);
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'timeout_error',
      message: 'The model request timed out.',
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(request.abort).toHaveBeenCalledTimes(1);
    await rejection;
    vi.useRealTimers();
  });

  it('preserves a caller-initiated abort instead of converting it into a timeout', async () => {
    vi.useFakeTimers();
    const abortError = new DOMException('This operation was aborted', 'AbortError');
    const request = createAbortableRequest<string>(
      () =>
        new Promise((_resolve, reject) => {
          request.abort.mockImplementation(() => {
            reject(abortError);
          });
        }),
    );

    const promise = unwrapAbortableRequestWithTimeout(request, 30_000);
    request.abort();

    await expect(promise).rejects.toBe(abortError);
    vi.runOnlyPendingTimers();
    expect(request.abort).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

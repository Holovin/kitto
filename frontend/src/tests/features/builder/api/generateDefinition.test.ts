import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuilderLlmRequest, BuilderLlmResponse } from '@features/builder/types';
import { generateBuilderDefinition } from '@features/builder/api/generateDefinition';

const request: BuilderLlmRequest = {
  prompt: 'Build a todo app',
  currentSource: '',
  chatHistory: [],
  mode: 'initial',
};

function createPendingAbortableResponse(signal: AbortSignal) {
  return new Promise<Response>((_resolve, reject) => {
    const abortRequest = () => {
      signal.removeEventListener('abort', abortRequest);
      reject(new DOMException('This operation was aborted', 'AbortError'));
    };

    if (signal.aborted) {
      abortRequest();
      return;
    }

    signal.addEventListener('abort', abortRequest, { once: true });
  });
}

function createGenerateRequestOptions(overrides: Partial<Parameters<typeof generateBuilderDefinition>[0]> = {}) {
  return {
    apiBaseUrl: 'http://localhost:8787/api',
    request,
    timeoutMs: 120_000,
    ...overrides,
  };
}

describe('generateBuilderDefinition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('aborts the fallback request when the active request is cancelled', async () => {
    const callerAbortController = new AbortController();
    let requestSignal: AbortSignal | null | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal;
        return createPendingAbortableResponse(init?.signal as AbortSignal);
      }),
    );

    const promise = generateBuilderDefinition(
      createGenerateRequestOptions({
        signal: callerAbortController.signal,
      }),
    );

    callerAbortController.abort();

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('aborts the fallback request when it exceeds the max duration timeout', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal;
        return createPendingAbortableResponse(init?.signal as AbortSignal);
      }),
    );

    const promise = generateBuilderDefinition(
      createGenerateRequestOptions({
        timeoutMs: 30_000,
      }),
    );
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'timeout_error',
      message: 'The model request timed out.',
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(requestSignal?.aborted).toBe(true);
    await rejection;
  });

  it('stays aborted even if a late fallback response resolves after cancellation', async () => {
    const callerAbortController = new AbortController();
    let resolveResponse: ((response: Response) => void) | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;

        return new Promise<Response>((resolve, reject) => {
          resolveResponse = resolve;
          const abortRequest = () => {
            signal.removeEventListener('abort', abortRequest);
            reject(new DOMException('This operation was aborted', 'AbortError'));
          };

          if (signal.aborted) {
            abortRequest();
            return;
          }

          signal.addEventListener('abort', abortRequest, { once: true });
        });
      }),
    );

    const promise = generateBuilderDefinition(
      createGenerateRequestOptions({
        signal: callerAbortController.signal,
      }),
    );

    callerAbortController.abort();

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(resolveResponse).not.toBeNull();

    if (!resolveResponse) {
      throw new Error('Expected the late response resolver to be captured.');
    }

    const resolveLateResponse = resolveResponse as (response: Response) => void;

    resolveLateResponse(
      new Response(
        JSON.stringify({
          model: 'gpt-5.4-mini',
          source: 'root = AppShell([])',
        } satisfies BuilderLlmResponse),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );

    await Promise.resolve();
  });
});

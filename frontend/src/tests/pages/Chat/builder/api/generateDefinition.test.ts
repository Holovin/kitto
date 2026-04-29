import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBuildRequest, BuilderLlmResponse } from '@pages/Chat/builder/types';
import { generateBuilderDefinition } from '@pages/Chat/builder/api/generateDefinition';

const request: PromptBuildRequest = {
  prompt: 'Build a todo app',
  currentSource: '',
  mode: 'initial',
};
const testAppMemory = {
  version: 1 as const,
  appSummary: 'Test app',
  userPreferences: ['Keep the test UI compact.'],
  avoid: [] as string[],
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
          appMemory: testAppMemory,
          changeSummary: 'Test generation change.',
          summary: 'Updated the app.',
          model: 'gpt-5.4-mini',
          source: 'root = AppShell([])',
          temperature: 0.4,
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

  it('includes x-kitto-request-id when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          appMemory: testAppMemory,
          changeSummary: 'Test generation change.',
          summary: 'Updated the app.',
          model: 'gpt-5.4-mini',
          source: 'root = AppShell([])',
          temperature: 0.4,
        } satisfies BuilderLlmResponse),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateBuilderDefinition(
        createGenerateRequestOptions({
          requestId: 'builder-request-123',
        }),
      ),
    ).resolves.toEqual({
      appMemory: testAppMemory,
      changeSummary: 'Test generation change.',
      model: 'gpt-5.4-mini',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      temperature: 0.4,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/llm/generate',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-kitto-request-id': 'builder-request-123',
        }),
      }),
    );
  });

  it('passes through summaryExcludeFromLlmContext when the backend marks the summary as technical', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              appMemory: testAppMemory,
              changeSummary: 'Test generation change.',
              model: 'gpt-5.4-mini',
              source: 'root = AppShell([])',
              summary: 'Updated the app.',
            summaryExcludeFromLlmContext: true,
            temperature: 0.4,
          } satisfies BuilderLlmResponse),
          {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(generateBuilderDefinition(createGenerateRequestOptions())).resolves.toEqual({
      appMemory: testAppMemory,
      changeSummary: 'Test generation change.',
      model: 'gpt-5.4-mini',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      summaryExcludeFromLlmContext: true,
      temperature: 0.4,
    });
  });

  it('marks automatic repair requests with a dedicated transport header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          appMemory: testAppMemory,
          changeSummary: 'Test generation change.',
          summary: 'Updated the app.',
          model: 'gpt-5.4-mini',
          source: 'root = AppShell([])',
          temperature: 0.2,
        } satisfies BuilderLlmResponse),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateBuilderDefinition(
      createGenerateRequestOptions({
        requestId: 'builder-request-repair',
        requestKind: 'automatic-repair',
        request: {
          ...request,
          mode: 'repair',
          parentRequestId: 'builder-request-parent',
          repairAttemptNumber: 1,
        },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/llm/generate',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-kitto-automatic-repair': '1',
          'x-kitto-repair-attempt': '1',
          'x-kitto-repair-for': 'builder-request-parent',
          'x-kitto-request-id': 'builder-request-repair',
        }),
      }),
    );
  });

  it('marks stream fallback requests with a dedicated transport header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          appMemory: testAppMemory,
          changeSummary: 'Test generation change.',
          summary: 'Updated the app.',
          model: 'gpt-5.4-mini',
          source: 'root = AppShell([])',
          temperature: 0.4,
        } satisfies BuilderLlmResponse),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateBuilderDefinition(
      createGenerateRequestOptions({
        requestId: 'builder-request-fallback',
        requestKind: 'stream-fallback',
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/llm/generate',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-kitto-request-id': 'builder-request-fallback',
          'x-kitto-stream-fallback': '1',
        }),
      }),
    );
  });

  it('serializes repair linkage fields into the fallback request body', async () => {
    const repairRequest: PromptBuildRequest = {
      ...request,
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      mode: 'repair',
      parentRequestId: 'builder-request-parent',
      validationIssues: [
        {
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          source: 'parser',
          statementId: 'items',
        },
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          source: 'quality',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          appMemory: testAppMemory,
          changeSummary: 'Test generation change.',
          summary: 'Updated the app.',
          model: 'gpt-5.4-mini',
          source: 'root = AppShell([])',
          temperature: 0.2,
        } satisfies BuilderLlmResponse),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateBuilderDefinition(
      createGenerateRequestOptions({
        requestId: 'builder-request-repair',
        request: repairRequest,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(JSON.parse(String(requestInit?.body))).toEqual({
      prompt: 'Build a todo app',
      currentSource: '',
      previousChangeSummaries: [],
      previousUserMessages: [],
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      mode: 'repair',
      parentRequestId: 'builder-request-parent',
      validationIssues: [
        {
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          source: 'parser',
          statementId: 'items',
        },
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          source: 'quality',
        },
      ],
    });
  });

  it('returns backend qualityIssues from the fallback response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            appMemory: testAppMemory,
            changeSummary: 'Test generation change.',
            summary: 'Updated the app.',
            model: 'gpt-5.4-mini',
            qualityIssues: [
              {
                code: 'quality-missing-todo-controls',
                message: 'Todo request did not generate required todo controls.',
                severity: 'blocking-quality',
                source: 'quality',
              },
            ],
            source: 'root = AppShell([])',
            temperature: 0.4,
          } satisfies BuilderLlmResponse),
          {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(generateBuilderDefinition(createGenerateRequestOptions())).resolves.toEqual({
      appMemory: testAppMemory,
      changeSummary: 'Test generation change.',
      model: 'gpt-5.4-mini',
      qualityIssues: [
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          severity: 'blocking-quality',
          source: 'quality',
        },
      ],
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      temperature: 0.4,
    });
  });
});

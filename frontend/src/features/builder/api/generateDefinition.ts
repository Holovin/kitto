import type { BuilderLlmRequest, BuilderLlmResponse } from '@features/builder/types';
import { createBuilderRequestError } from './requestErrors';
import { unwrapAbortableRequestWithTimeout } from './requestTimeout';

interface GenerateBuilderDefinitionOptions {
  apiBaseUrl: string;
  request: BuilderLlmRequest;
  signal?: AbortSignal;
  timeoutMs: number;
}

function createLinkedAbortController(signal?: AbortSignal) {
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

async function getResponseError(response: Response) {
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

export async function generateBuilderDefinition({
  apiBaseUrl,
  request,
  signal,
  timeoutMs,
}: GenerateBuilderDefinitionOptions): Promise<BuilderLlmResponse> {
  const { abortController, cleanup } = createLinkedAbortController(signal);

  try {
    return await unwrapAbortableRequestWithTimeout(
      {
        abort: () => abortController.abort(),
        unwrap: async () => {
          const response = await fetch(`${apiBaseUrl}/llm/generate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(request),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw await getResponseError(response);
          }

          return (await response.json()) as BuilderLlmResponse;
        },
      },
      timeoutMs,
    );
  } finally {
    cleanup();
  }
}

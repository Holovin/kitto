import type { BuilderLlmRequest, BuilderLlmResponse } from '@features/builder/types';
import { createBuilderRequestError } from './requestErrors';
import { serializeBuilderLlmRequest } from './requestBody';
import { unwrapAbortableRequestWithTimeout } from './requestTimeout';

interface GenerateBuilderDefinitionOptions {
  apiBaseUrl: string;
  requestId?: string;
  requestKind?: 'automatic-repair' | 'default' | 'stream-fallback';
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

function getAutomaticRepairHeaders(request: BuilderLlmRequest) {
  if (!request.parentRequestId || !request.repairAttemptNumber) {
    return {
      'x-kitto-automatic-repair': '1',
    };
  }

  return {
    'x-kitto-automatic-repair': '1',
    'x-kitto-repair-attempt': String(request.repairAttemptNumber),
    'x-kitto-repair-for': request.parentRequestId,
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
  requestId,
  requestKind = 'default',
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
              ...(requestKind === 'automatic-repair' ? getAutomaticRepairHeaders(request) : {}),
              ...(requestKind === 'stream-fallback' ? { 'x-kitto-stream-fallback': '1' } : {}),
              ...(requestId ? { 'x-kitto-request-id': requestId } : {}),
            },
            body: serializeBuilderLlmRequest(request),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw await getResponseError(response);
          }

          const payload = (await response.json()) as BuilderLlmResponse;

          return {
            ...payload,
            qualityIssues: payload.qualityIssues ?? [],
          };
        },
      },
      timeoutMs,
    );
  } finally {
    cleanup();
  }
}

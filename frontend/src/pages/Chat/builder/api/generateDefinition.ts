import type { PromptBuildRequest, BuilderLlmResponse } from '@pages/Chat/builder/types';
import { createBuilderResponseError } from './requestErrors';
import { serializeBuilderLlmRequest } from './requestBody';
import { createLinkedAbortController } from './streamAbort';
import { unwrapAbortableRequestWithTimeout } from './requestTimeout';

interface GenerateBuilderDefinitionOptions {
  apiBaseUrl: string;
  requestId?: string;
  requestKind?: 'automatic-repair' | 'default' | 'stream-fallback';
  request: PromptBuildRequest;
  signal?: AbortSignal;
  timeoutMs: number;
}

function getAutomaticRepairHeaders(request: PromptBuildRequest): Record<string, string> {
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

function createGenerationHeaders(
  request: PromptBuildRequest,
  requestKind: GenerateBuilderDefinitionOptions['requestKind'],
  requestId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (requestKind === 'automatic-repair') {
    Object.assign(headers, getAutomaticRepairHeaders(request));
  }

  if (requestKind === 'stream-fallback') {
    headers['x-kitto-stream-fallback'] = '1';
  }

  if (requestId) {
    headers['x-kitto-request-id'] = requestId;
  }

  return headers;
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
            headers: createGenerationHeaders(request, requestKind, requestId),
            body: serializeBuilderLlmRequest(request),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw await createBuilderResponseError(response);
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

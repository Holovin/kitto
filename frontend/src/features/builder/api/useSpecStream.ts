import { useCallback, useRef, useState } from 'react';
import { applySpecStreamPatch, parseSpecStreamLine, type Spec } from '@json-render/core';
import type { GenerateRequest, GenerateResponse, RequestCompactionNotice } from './contracts';

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type UseSpecStreamOptions = {
  api: string;
  onComplete?: (spec: Spec) => void;
  onError?: (error: Error) => void;
};

type GenerateOnceResult = {
  result: GenerateResponse;
  requestCompactionNotice: RequestCompactionNotice | null;
};

function cloneSpec(spec: Spec | null | undefined): Spec {
  if (!spec?.root) {
    return { root: '', elements: {} };
  }

  return {
    ...spec,
    elements: { ...spec.elements },
    ...(spec.state ? { state: { ...spec.state } } : {}),
  };
}

function parseUsage(line: string): TokenUsage | null {
  try {
    const parsed = JSON.parse(line);

    if (parsed.__meta !== 'usage') {
      return null;
    }

    return {
      promptTokens: parsed.promptTokens ?? 0,
      completionTokens: parsed.completionTokens ?? 0,
      totalTokens: parsed.totalTokens ?? 0,
    };
  } catch {
    return null;
  }
}

function parseRequestCompactionNotice(headers: Headers): RequestCompactionNotice | null {
  const compacted = headers.get('X-Kitto-Request-Compacted');

  if (!compacted || compacted === '0' || compacted.toLowerCase() === 'false') {
    return null;
  }

  const actions = headers
    .get('X-Kitto-Request-Compaction-Actions')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) as RequestCompactionNotice['actions'] | undefined;
  const requestBytesHeader = headers.get('X-Kitto-Request-Bytes');
  const droppedMessagesHeader = headers.get('X-Kitto-Request-Dropped-Messages');

  return {
    actions: actions ?? [],
    requestBytes: requestBytesHeader ? Number(requestBytesHeader) : null,
    droppedMessages: droppedMessagesHeader ? Number(droppedMessagesHeader) : 0,
    droppedRawLines: headers.get('X-Kitto-Request-Dropped-Raw-Lines') === '1',
  };
}

async function parseResponseError(response: Response) {
  let errorMessage = `HTTP error: ${response.status}`;

  try {
    const errorData = (await response.json()) as { message?: string; error?: string };

    if (errorData.message) {
      errorMessage = errorData.message;
    } else if (errorData.error) {
      errorMessage = errorData.error;
    }
  } catch {
    // Ignore JSON parsing failures and fall back to the HTTP status.
  }

  return new Error(errorMessage);
}

function parseStreamPatchLine(line: string) {
  const patch = parseSpecStreamLine(line);

  if (!patch) {
    throw new Error('Invalid stream patch line received from backend.');
  }

  return patch;
}

export async function generateOnce(api: string, body: GenerateRequest, signal?: AbortSignal): Promise<GenerateOnceResult> {
  const response = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const requestCompactionNotice = parseRequestCompactionNotice(response.headers);

  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const result = (await response.json()) as GenerateResponse;

  if (!result?.spec || typeof result.spec !== 'object') {
    throw new Error('Fallback response did not include a valid spec.');
  }

  return {
    result,
    requestCompactionNotice,
  };
}

export function useSpecStream({ api, onComplete, onError }: UseSpecStreamOptions) {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [requestCompactionNotice, setRequestCompactionNotice] = useState<RequestCompactionNotice | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const clear = useCallback(() => {
    setSpec(null);
    setError(null);
    setRequestCompactionNotice(null);
  }, []);

  const send = useCallback(
    async (body: GenerateRequest) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      setIsStreaming(true);
      setError(null);
      setUsage(null);
      setRawLines([]);
      setRequestCompactionNotice(null);

      let currentSpec = cloneSpec(body.currentSpec);
      setSpec(currentSpec);

      try {
        const response = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortControllerRef.current.signal,
        });

        setRequestCompactionNotice(parseRequestCompactionNotice(response.headers));

        if (!response.ok) {
          throw await parseResponseError(response);
        }

        const reader = response.body?.getReader();

        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) {
              continue;
            }

            const usageLine = parseUsage(trimmed);

            if (usageLine) {
              setUsage(usageLine);
              continue;
            }

            const patch = parseStreamPatchLine(trimmed);

            setRawLines((previous) => [...previous, trimmed]);
            currentSpec = applySpecStreamPatch<Record<string, unknown>>(
              currentSpec as unknown as Record<string, unknown>,
              patch,
            ) as unknown as Spec;
            setSpec(cloneSpec(currentSpec));
          }
        }

        if (buffer.trim()) {
          const trimmed = buffer.trim();
          const usageLine = parseUsage(trimmed);

          if (usageLine) {
            setUsage(usageLine);
          } else {
            const patch = parseStreamPatchLine(trimmed);

            setRawLines((previous) => [...previous, trimmed]);
            currentSpec = applySpecStreamPatch<Record<string, unknown>>(
              currentSpec as unknown as Record<string, unknown>,
              patch,
            ) as unknown as Spec;
            setSpec(cloneSpec(currentSpec));
          }
        }

        onCompleteRef.current?.(currentSpec);
      } catch (streamError) {
        if (streamError instanceof DOMException && streamError.name === 'AbortError') {
          return;
        }

        const nextError = streamError instanceof Error ? streamError : new Error(String(streamError));
        setError(nextError);
        onErrorRef.current?.(nextError);
      } finally {
        setIsStreaming(false);
      }
    },
    [api],
  );

  return {
    spec,
    isStreaming,
    error,
    usage,
    rawLines,
    requestCompactionNotice,
    clear,
    send,
  };
}

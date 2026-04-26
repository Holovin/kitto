import type { PromptBuildRequest, BuilderLlmRequestCompaction, BuilderQualityIssue } from '@features/builder/types';
import { createPartialOpenUiEnvelopeParser, isMalformedStructuredChunk } from './partialOpenUiEnvelope';
import { createBuilderRequestError, createBuilderResponseError } from './requestErrors';
import { serializeBuilderLlmRequest } from './requestBody';
import { createAbortError, createLinkedAbortController } from './streamAbort';
import { normalizeSseChunkLineEndings, parseServerSentEvent } from './streamSse';
import {
  createBuilderStreamTimeoutManager,
  type BuilderStreamTimeoutKind,
} from './streamTimeouts';

export { parseServerSentEvent } from './streamSse';
export { BuilderStreamTimeoutError, type BuilderStreamTimeoutKind } from './streamTimeouts';

interface StreamBuilderDefinitionOptions {
  apiBaseUrl: string;
  idleTimeoutMs: number;
  maxDurationMs: number;
  onChunk: (chunk: string) => void;
  onSummary?: (summary: string) => void;
  onTimeout?: (kind: BuilderStreamTimeoutKind) => void;
  requestId?: string;
  request: PromptBuildRequest;
  signal?: AbortSignal;
}

interface StreamDonePayload {
  compaction?: BuilderLlmRequestCompaction;
  model?: string;
  qualityIssues?: BuilderQualityIssue[];
  source?: string;
  summary?: string;
  summaryExcludeFromLlmContext?: boolean;
  temperature?: number;
}

interface StreamBuilderDefinitionResult {
  compaction?: BuilderLlmRequestCompaction;
  qualityIssues: BuilderQualityIssue[];
  source: string;
  summary?: string;
  summaryExcludeFromLlmContext?: boolean;
}

function hasDoneSource(payload: StreamDonePayload): payload is StreamDonePayload & { source: string } {
  return typeof payload.source === 'string' && payload.source.length > 0;
}

export async function streamBuilderDefinition({
  apiBaseUrl,
  idleTimeoutMs,
  maxDurationMs,
  onChunk,
  onSummary,
  onTimeout,
  requestId,
  request,
  signal,
}: StreamBuilderDefinitionOptions): Promise<StreamBuilderDefinitionResult> {
  const { abortController, cleanup } = createLinkedAbortController(signal);
  const timeoutManager = createBuilderStreamTimeoutManager({
    abort: () => abortController.abort(),
    idleTimeoutMs,
    maxDurationMs,
    onTimeout,
    shouldAbort: () => abortController.signal.aborted,
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let receivedDone = false;

  timeoutManager.startMaxDurationTimeout();

  try {
    const response = await fetch(`${apiBaseUrl}/llm/generate/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(requestId ? { 'x-kitto-request-id': requestId } : {}),
      },
      body: serializeBuilderLlmRequest(request),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw await createBuilderResponseError(response);
    }

    if (!response.body) {
      throw new Error('Streaming response body is not available.');
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const structuredEnvelopeParser = createPartialOpenUiEnvelopeParser();
    let lastParsedSource = '';
    let lastParsedSummary = '';
    let pendingCarriageReturn = false;
    let donePayload: StreamDonePayload | undefined;
    let streamMode: 'plain' | 'structured' | 'unknown' = 'unknown';

    timeoutManager.restartIdleTimeout();

    while (true) {
      const { done, value } = await reader.read();
      const decodedChunk = decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      });
      const normalizedChunk = normalizeSseChunkLineEndings(decodedChunk, pendingCarriageReturn, done);
      pendingCarriageReturn = normalizedChunk.pendingCarriageReturn;
      buffer += normalizedChunk.normalizedText;

      const eventBlocks = buffer.split('\n\n');
      buffer = eventBlocks.pop() ?? '';

      for (const eventBlock of eventBlocks) {
        const parsedEvent = parseServerSentEvent(eventBlock);

        if (parsedEvent.event === 'chunk') {
          timeoutManager.restartIdleTimeout();

          if (streamMode === 'unknown') {
            const firstMeaningfulCharacter = parsedEvent.data.trimStart().charAt(0);

            if (firstMeaningfulCharacter === '{') {
              streamMode = 'structured';
            } else if (firstMeaningfulCharacter) {
              streamMode = 'plain';
            }
          }

          if (streamMode === 'structured') {
            if (isMalformedStructuredChunk(parsedEvent.data)) {
              console.warn('[builder.stream] Ignoring malformed structured chunk.');
              continue;
            }

            const partialEnvelope = structuredEnvelopeParser.append(parsedEvent.data);
            const nextSource = partialEnvelope.source?.value ?? '';
            const nextSummary = partialEnvelope.summary?.value;

            if (typeof nextSummary === 'string' && nextSummary !== lastParsedSummary) {
              lastParsedSummary = nextSummary;
              onSummary?.(nextSummary);
            }

            if (nextSource && nextSource.startsWith(lastParsedSource)) {
              const delta = nextSource.slice(lastParsedSource.length);

              if (delta) {
                lastParsedSource = nextSource;
                onChunk(delta);
              }
            } else if (nextSource) {
              lastParsedSource = nextSource;
              onChunk(nextSource);
            }

            continue;
          }

          onChunk(parsedEvent.data);
          continue;
        }

        if (parsedEvent.event === 'error') {
          throw createBuilderRequestError(parsedEvent.data, {
            message: 'The backend stream returned an error.',
          });
        }

        if (parsedEvent.event === 'done') {
          timeoutManager.restartIdleTimeout();
          try {
            donePayload = JSON.parse(parsedEvent.data) as StreamDonePayload;
          } catch {
            throw new Error('Received a malformed "done" event from the backend stream.');
          }

          receivedDone = true;
          break;
        }
      }

      if (receivedDone) {
        break;
      }

      if (done) {
        break;
      }
    }

    if (receivedDone && donePayload) {
      if (!hasDoneSource(donePayload)) {
        throw new Error('Received an invalid "done" event from the backend stream.');
      }

      return {
        compaction: donePayload.compaction,
        qualityIssues: donePayload.qualityIssues ?? [],
        source: donePayload.source,
        summary: donePayload.summary,
        summaryExcludeFromLlmContext: donePayload.summaryExcludeFromLlmContext,
      };
    }

    const timeoutError = timeoutManager.getTimeoutError();

    if (timeoutError) {
      throw timeoutError;
    }

    if (signal?.aborted || abortController.signal.aborted) {
      throw createAbortError();
    }

    throw new Error('Stream ended before done event');
  } catch (error) {
    const timeoutError = timeoutManager.getTimeoutError();

    if (timeoutError) {
      throw timeoutError;
    }

    throw error;
  } finally {
    if (reader && abortController.signal.aborted && !receivedDone) {
      try {
        await reader.cancel();
      } catch {
        // Ignore reader cancellation failures during abort cleanup.
      }
    }

    timeoutManager.clearTimeouts();
    cleanup();
  }
}

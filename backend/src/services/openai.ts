import OpenAI, { APIUserAbortError } from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '../env.js';
import { UpstreamFailureError } from '../errors/publicError.js';
import { getByteLength } from '../limits.js';
import { buildOpenUiSystemPrompt, buildOpenUiUserPrompt, type PromptBuildRequest } from '../prompts/openui.js';

let cachedClient: { apiKey: string; client: OpenAI } | null = null;

function getClient(env: AppEnv) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  if (!cachedClient || cachedClient.apiKey !== env.OPENAI_API_KEY) {
    cachedClient = {
      apiKey: env.OPENAI_API_KEY,
      client: new OpenAI({
        apiKey: env.OPENAI_API_KEY,
      }),
    };
  }

  return cachedClient.client;
}

function buildResponseInput(env: AppEnv, request: PromptBuildRequest): ResponseInput {
  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: buildOpenUiSystemPrompt() }],
    },
    {
      role: 'user',
      content: [{ type: 'input_text', text: buildOpenUiUserPrompt(request, { chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS }) }],
    },
  ];
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const directOutputText = (response as { output_text?: unknown }).output_text;

  if (typeof directOutputText === 'string' && directOutputText.trim()) {
    return directOutputText;
  }

  const outputItems = (response as { output?: unknown }).output;

  if (!Array.isArray(outputItems)) {
    return null;
  }

  const collectedText = outputItems
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') {
        return [];
      }

      const content = (item as { content?: unknown }).content;

      if (!Array.isArray(content)) {
        return [];
      }

      return content.flatMap((part) => {
        if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'output_text') {
          return [];
        }

        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? [text] : [];
      });
    })
    .join('');

  return collectedText || null;
}

function normalizeOpenUiSource(rawSource: unknown) {
  if (typeof rawSource !== 'string') {
    throw new UpstreamFailureError('The model response did not include text output.');
  }

  const trimmedSource = rawSource.trim();

  if (!trimmedSource) {
    throw new UpstreamFailureError('The model returned an empty OpenUI document.');
  }

  if (!trimmedSource.startsWith('```')) {
    return trimmedSource;
  }

  return trimmedSource.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '').trim();
}

function throwIfAborted(signal?: AbortSignal, stream?: { abort?: () => void }) {
  if (!signal?.aborted) {
    return;
  }

  stream?.abort?.();
  throw new APIUserAbortError();
}

function assertModelOutputWithinLimit(source: string, env: AppEnv) {
  const outputSizeBytes = getByteLength(source);

  if (outputSizeBytes > env.LLM_OUTPUT_MAX_BYTES) {
    throw new UpstreamFailureError(
      `Model output size ${outputSizeBytes} bytes exceeded the backend limit of ${env.LLM_OUTPUT_MAX_BYTES} bytes.`,
    );
  }
}

export async function generateOpenUiSource(env: AppEnv, request: PromptBuildRequest, signal?: AbortSignal) {
  const client = getClient(env);
  const response = await client.responses.create(
    {
      model: env.OPENAI_MODEL,
      input: buildResponseInput(env, request),
    },
    {
      signal,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    },
  );

  const source = normalizeOpenUiSource(extractResponseText(response));
  assertModelOutputWithinLimit(source, env);
  return source;
}

export async function streamOpenUiSource(
  env: AppEnv,
  request: PromptBuildRequest,
  onTextDelta: (delta: string) => Promise<void> | void,
  signal?: AbortSignal,
) {
  const client = getClient(env);
  const stream = client.responses.stream(
    {
      model: env.OPENAI_MODEL,
      input: buildResponseInput(env, request),
    },
    {
      signal,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    },
  );
  let streamedText = '';
  let streamedTextBytes = 0;

  for await (const event of stream) {
    throwIfAborted(signal, stream);

    if (event.type === 'response.output_text.delta' && event.delta) {
      throwIfAborted(signal, stream);
      streamedTextBytes += getByteLength(event.delta);
      if (streamedTextBytes > env.LLM_OUTPUT_MAX_BYTES) {
        stream.abort();
        throw new UpstreamFailureError(
          `Streamed model output exceeded the backend limit of ${env.LLM_OUTPUT_MAX_BYTES} bytes.`,
        );
      }

      streamedText += event.delta;
      await onTextDelta(event.delta);
    }
  }

  throwIfAborted(signal, stream);
  const finalResponse = await stream.finalResponse();
  const source = normalizeOpenUiSource(extractResponseText(finalResponse) ?? streamedText);
  assertModelOutputWithinLimit(source, env);
  return source;
}

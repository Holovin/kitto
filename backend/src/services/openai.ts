import OpenAI, { APIUserAbortError } from 'openai';
import type { ResponseFormatTextJSONSchemaConfig, ResponseInput } from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { UpstreamFailureError } from '../errors/publicError.js';
import { getByteLength, getRawStructuredOutputMaxBytes } from '../limits.js';
import { buildOpenUiSystemPrompt, buildOpenUiUserPrompt, type PromptBuildRequest } from '../prompts/openui.js';

let cachedClient: { apiKey: string; client: OpenAI } | null = null;

export const OpenUiGenerationEnvelopeSchema = z
  .object({
    source: z.string().min(1),
  })
  .strict();

export type OpenUiGenerationEnvelope = z.infer<typeof OpenUiGenerationEnvelopeSchema>;

const openUiEnvelopeFormat: ResponseFormatTextJSONSchemaConfig = {
  type: 'json_schema',
  name: 'kitto_openui_source',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: {
      source: {
        type: 'string',
      },
    },
  },
};

// Keep initial drafts somewhat creative, but make repair passes deliberately tighter.
const INITIAL_OPENUI_TEMPERATURE = 0.6;
const REPAIR_OPENUI_TEMPERATURE = 0.2;
const OPENUI_MAX_OUTPUT_TOKENS_FLOOR = 4_096;

function getOpenUiTemperature(mode: PromptBuildRequest['mode']) {
  return mode === 'repair' ? REPAIR_OPENUI_TEMPERATURE : INITIAL_OPENUI_TEMPERATURE;
}

function getOpenUiMaxOutputTokens(env: AppEnv) {
  // Keep an explicit token ceiling instead of inheriting model defaults; the byte limit
  // remains the hard backend guardrail for the returned source/envelope.
  return Math.max(OPENUI_MAX_OUTPUT_TOKENS_FLOOR, Math.ceil(env.LLM_OUTPUT_MAX_BYTES / 4));
}

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
      content: [{ type: 'input_text', text: buildOpenUiSystemPrompt({ structuredOutput: env.LLM_STRUCTURED_OUTPUT }) }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: buildOpenUiUserPrompt(request, {
            chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
            structuredOutput: env.LLM_STRUCTURED_OUTPUT,
          }),
        },
      ],
    },
  ];
}

function buildResponseRequest(env: AppEnv, request: PromptBuildRequest) {
  const baseRequest = {
    model: env.OPENAI_MODEL,
    input: buildResponseInput(env, request),
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    temperature: getOpenUiTemperature(request.mode),
  };

  if (!env.LLM_STRUCTURED_OUTPUT) {
    return baseRequest;
  }

  return {
    ...baseRequest,
    text: {
      format: openUiEnvelopeFormat,
    },
  };
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

function createRawStructuredOutputLimitError(outputSizeBytes: number, rawLimitBytes: number) {
  return new UpstreamFailureError(
    `Structured model output size ${outputSizeBytes} bytes exceeded the backend raw envelope limit of ${rawLimitBytes} bytes.`,
  );
}

function assertRawStructuredOutputWithinLimit(rawOutput: string, env: AppEnv) {
  const outputSizeBytes = getByteLength(rawOutput);
  const rawLimitBytes = getRawStructuredOutputMaxBytes(env);

  if (outputSizeBytes > rawLimitBytes) {
    throw createRawStructuredOutputLimitError(outputSizeBytes, rawLimitBytes);
  }
}

function parseOpenUiGenerationEnvelope(rawEnvelopeText: string) {
  const trimmedEnvelopeText = rawEnvelopeText.trim();

  if (!trimmedEnvelopeText) {
    throw new UpstreamFailureError('The model returned an empty structured response.');
  }

  let parsedEnvelope: unknown;

  try {
    parsedEnvelope = JSON.parse(trimmedEnvelopeText);
  } catch {
    throw new UpstreamFailureError('The model returned malformed structured output.');
  }

  const envelopeResult = OpenUiGenerationEnvelopeSchema.safeParse(parsedEnvelope);

  if (!envelopeResult.success) {
    throw new UpstreamFailureError('The model returned an invalid OpenUI response envelope.');
  }

  return envelopeResult.data;
}

function extractOpenUiSourceFromModelText(rawModelText: unknown, env: AppEnv) {
  if (env.LLM_STRUCTURED_OUTPUT) {
    if (typeof rawModelText !== 'string') {
      throw new UpstreamFailureError('The model response did not include text output.');
    }

    assertRawStructuredOutputWithinLimit(rawModelText, env);
    return parseOpenUiGenerationEnvelope(rawModelText).source;
  }

  return normalizeOpenUiSource(rawModelText);
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
    buildResponseRequest(env, request),
    {
      signal,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    },
  );

  const source = extractOpenUiSourceFromModelText(extractResponseText(response), env);
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
    buildResponseRequest(env, request),
    {
      signal,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    },
  );
  let streamedText = '';
  let streamedTextBytes = 0;
  let hasAbortedStream = false;
  const abortStream = () => {
    if (hasAbortedStream) {
      return;
    }

    hasAbortedStream = true;
    stream.abort();
  };
  const handleAbort = () => {
    abortStream();
  };

  if (signal?.aborted) {
    handleAbort();
    throw new APIUserAbortError();
  }

  signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    for await (const event of stream) {
      throwIfAborted(signal, { abort: abortStream });

      if (event.type === 'response.output_text.delta' && event.delta) {
        throwIfAborted(signal, { abort: abortStream });
        streamedTextBytes += getByteLength(event.delta);
        if (env.LLM_STRUCTURED_OUTPUT) {
          const rawLimitBytes = getRawStructuredOutputMaxBytes(env);

          if (streamedTextBytes > rawLimitBytes) {
            abortStream();
            throw createRawStructuredOutputLimitError(streamedTextBytes, rawLimitBytes);
          }
        } else if (streamedTextBytes > env.LLM_OUTPUT_MAX_BYTES) {
          abortStream();
          throw new UpstreamFailureError(
            `Streamed model output exceeded the backend limit of ${env.LLM_OUTPUT_MAX_BYTES} bytes.`,
          );
        }

        streamedText += event.delta;
        await onTextDelta(event.delta);
      }
    }

    throwIfAborted(signal, { abort: abortStream });
    const finalResponse = await stream.finalResponse();
    throwIfAborted(signal, { abort: abortStream });
    const source = extractOpenUiSourceFromModelText(streamedText || extractResponseText(finalResponse), env);
    assertModelOutputWithinLimit(source, env);
    return source;
  } finally {
    signal?.removeEventListener('abort', handleAbort);
  }
}

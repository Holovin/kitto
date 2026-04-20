import OpenAI, { APIUserAbortError } from 'openai';
import type { ResponseFormatTextJSONSchemaConfig, ResponseInput } from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { UpstreamFailureError } from '../errors/publicError.js';
import { getByteLength, getRawStructuredOutputMaxBytes } from '../limits.js';
import { buildOpenUiSystemPrompt, buildOpenUiUserPrompt, getOpenUiSystemPromptCacheKey, type PromptBuildRequest } from '../prompts/openui.js';

let cachedClient: { apiKey: string; client: OpenAI } | null = null;

export const OpenUiGenerationEnvelopeSchema = z
  .object({
    summary: z.string().max(200).optional(),
    source: z.string().min(1),
    notes: z.array(z.string().max(200)).max(5).optional(),
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
      summary: {
        type: 'string',
        maxLength: 200,
      },
      source: {
        type: 'string',
      },
      notes: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'string',
          maxLength: 200,
        },
      },
    },
  },
};

// Keep initial drafts somewhat creative, but make repair passes deliberately tighter.
const INITIAL_OPENUI_TEMPERATURE = 0.6;
const REPAIR_OPENUI_TEMPERATURE = 0.2;
const OPENUI_MAX_OUTPUT_TOKENS_FLOOR = 4_096;
const STRUCTURED_SYSTEM_PROMPT = buildOpenUiSystemPrompt();
const PLAIN_TEXT_SYSTEM_PROMPT = buildOpenUiSystemPrompt({ structuredOutput: false });
const STRUCTURED_SYSTEM_PROMPT_CACHE_KEY = getOpenUiSystemPromptCacheKey();
const PLAIN_TEXT_SYSTEM_PROMPT_CACHE_KEY = getOpenUiSystemPromptCacheKey({ structuredOutput: false });

function getOpenUiTemperature(mode: PromptBuildRequest['mode']) {
  return mode === 'repair' ? REPAIR_OPENUI_TEMPERATURE : INITIAL_OPENUI_TEMPERATURE;
}

function getOpenUiMaxOutputTokens(env: AppEnv) {
  // Keep an explicit token ceiling instead of inheriting model defaults; the byte limit
  // remains the hard backend guardrail for the returned source/envelope.
  return Math.max(OPENUI_MAX_OUTPUT_TOKENS_FLOOR, Math.ceil(env.LLM_OUTPUT_MAX_BYTES / 4));
}

function getSystemPrompt(structuredOutput: boolean) {
  return structuredOutput ? STRUCTURED_SYSTEM_PROMPT : PLAIN_TEXT_SYSTEM_PROMPT;
}

function getSystemPromptCacheKey(structuredOutput: boolean) {
  return structuredOutput ? STRUCTURED_SYSTEM_PROMPT_CACHE_KEY : PLAIN_TEXT_SYSTEM_PROMPT_CACHE_KEY;
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
  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;

  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: getSystemPrompt(structuredOutput) }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: buildOpenUiUserPrompt(request, {
            chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
            structuredOutput,
          }),
        },
      ],
    },
  ];
}

function buildResponseRequest(env: AppEnv, request: PromptBuildRequest) {
  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;
  const baseRequest = {
    model: env.OPENAI_MODEL,
    input: buildResponseInput(env, request),
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    prompt_cache_key: getSystemPromptCacheKey(structuredOutput),
    temperature: getOpenUiTemperature(request.mode),
  };

  if (!structuredOutput) {
    return baseRequest;
  }

  return {
    ...baseRequest,
    text: {
      format: openUiEnvelopeFormat,
    },
  };
}

function getNumericField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getCachedInputTokens(usage: unknown) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const currentCachedTokens = getNumericField(
    (usage as { input_tokens_details?: { cached_tokens?: unknown } }).input_tokens_details?.cached_tokens,
  );

  if (currentCachedTokens !== null) {
    return currentCachedTokens;
  }

  return getNumericField((usage as { prompt_tokens_details?: { cached_tokens?: unknown } }).prompt_tokens_details?.cached_tokens);
}

function logResponseUsage(env: AppEnv, phase: 'create' | 'stream', response: unknown) {
  if (env.LOG_LEVEL !== 'debug' && env.LOG_LEVEL !== 'info') {
    return;
  }

  if (!response || typeof response !== 'object') {
    return;
  }

  const usage = (response as { usage?: unknown }).usage;

  if (!usage || typeof usage !== 'object') {
    return;
  }

  const inputTokens =
    getNumericField((usage as { input_tokens?: unknown }).input_tokens) ??
    getNumericField((usage as { prompt_tokens?: unknown }).prompt_tokens);
  const outputTokens =
    getNumericField((usage as { output_tokens?: unknown }).output_tokens) ??
    getNumericField((usage as { completion_tokens?: unknown }).completion_tokens);
  const totalTokens = getNumericField((usage as { total_tokens?: unknown }).total_tokens);
  const cachedTokens = getCachedInputTokens(usage);
  const requestId = typeof (response as { _request_id?: unknown })._request_id === 'string' ? (response as { _request_id?: string })._request_id : null;

  console.log(
    `[openai.responses.${phase}] request_id=${requestId ?? 'unknown'} input_tokens=${inputTokens ?? 'unknown'} cached_tokens=${cachedTokens ?? 'unknown'} output_tokens=${outputTokens ?? 'unknown'} total_tokens=${totalTokens ?? 'unknown'}`,
  );
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

function extractOpenUiEnvelopeFromModelText(rawModelText: unknown, env: AppEnv): OpenUiGenerationEnvelope {
  if (env.LLM_STRUCTURED_OUTPUT) {
    if (typeof rawModelText !== 'string') {
      throw new UpstreamFailureError('The model response did not include text output.');
    }

    assertRawStructuredOutputWithinLimit(rawModelText, env);
    return parseOpenUiGenerationEnvelope(rawModelText);
  }

  return {
    source: normalizeOpenUiSource(rawModelText),
  };
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
  logResponseUsage(env, 'create', response);

  const envelope = extractOpenUiEnvelopeFromModelText(extractResponseText(response), env);
  assertModelOutputWithinLimit(envelope.source, env);
  return envelope;
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
    logResponseUsage(env, 'stream', finalResponse);
    const finalResponseText = extractResponseText(finalResponse);
    const envelope = extractOpenUiEnvelopeFromModelText(finalResponseText || streamedText, env);
    assertModelOutputWithinLimit(envelope.source, env);
    return envelope;
  } finally {
    signal?.removeEventListener('abort', handleAbort);
  }
}

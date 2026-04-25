import type { ResponseFormatTextJSONSchemaConfig } from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { UpstreamFailureError } from '../../errors/publicError.js';
import { getByteLength, getRawStructuredOutputMaxBytes } from '../../limits.js';

export const OpenUiGenerationEnvelopeSchema = z
  .object({
    summary: z.string().max(200),
    source: z.string().min(1),
  })
  .strict();

export type OpenUiGenerationEnvelope = z.infer<typeof OpenUiGenerationEnvelopeSchema>;

function createOpenUiEnvelopeJsonSchema() {
  const jsonSchema = z.toJSONSchema(OpenUiGenerationEnvelopeSchema);

  delete jsonSchema.$schema;
  return jsonSchema;
}

export const openUiEnvelopeFormat: ResponseFormatTextJSONSchemaConfig = {
  type: 'json_schema',
  name: 'kitto_openui_source',
  strict: true,
  schema: createOpenUiEnvelopeJsonSchema(),
};

export function createRawStructuredOutputLimitError(outputSizeBytes: number, rawLimitBytes: number) {
  return new UpstreamFailureError(
    `Structured model output size ${outputSizeBytes} bytes exceeded the backend raw envelope limit of ${rawLimitBytes} bytes.`,
  );
}

export function assertRawStructuredOutputWithinLimit(rawOutput: string, env: AppEnv) {
  const outputSizeBytes = getByteLength(rawOutput);
  const rawLimitBytes = getRawStructuredOutputMaxBytes(env);

  if (outputSizeBytes > rawLimitBytes) {
    throw createRawStructuredOutputLimitError(outputSizeBytes, rawLimitBytes);
  }
}

export function parseOpenUiGenerationEnvelope(rawModelText: unknown, env?: AppEnv) {
  if (typeof rawModelText !== 'string') {
    throw new UpstreamFailureError('The model response did not include text output.');
  }

  if (env) {
    assertRawStructuredOutputWithinLimit(rawModelText, env);
  }

  const trimmedEnvelopeText = rawModelText.trim();

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

export function assertModelOutputWithinLimit(source: string, env: AppEnv) {
  const outputSizeBytes = getByteLength(source);

  if (outputSizeBytes > env.LLM_OUTPUT_MAX_BYTES) {
    throw new UpstreamFailureError(
      `Model output size ${outputSizeBytes} bytes exceeded the backend limit of ${env.LLM_OUTPUT_MAX_BYTES} bytes.`,
    );
  }
}

import type { ResponseFormatTextJSONSchemaConfig } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { appMemoryInputSchema, appMemorySchema, normalizeAppMemory } from '@kitto-openui/shared/builderApiContract.js';
import type { AppEnv } from '#backend/env.js';
import { UpstreamFailureError } from '#backend/errors/publicError.js';
import { getByteLength, getRawStructuredOutputMaxBytes } from '#backend/limits.js';

export const OpenUiGenerationEnvelopeSchema = z
  .object({
    summary: z.string().max(200),
    changeSummary: z.string().max(300),
    source: z.string().min(1),
    appMemory: appMemorySchema,
  })
  .strict();

export type OpenUiGenerationEnvelope = z.infer<typeof OpenUiGenerationEnvelopeSchema>;

const OpenUiGenerationEnvelopeParseSchema = OpenUiGenerationEnvelopeSchema.extend({
  appMemory: appMemoryInputSchema,
});

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

  const envelopeResult = OpenUiGenerationEnvelopeParseSchema.safeParse(parsedEnvelope);

  if (!envelopeResult.success) {
    throw new UpstreamFailureError('The model returned an invalid OpenUI response envelope.');
  }

  return {
    ...envelopeResult.data,
    appMemory: normalizeAppMemory(envelopeResult.data.appMemory),
  };
}

export function assertModelOutputWithinLimit(source: string, env: AppEnv) {
  const outputSizeBytes = getByteLength(source);

  if (outputSizeBytes > env.outputMaxBytes) {
    throw new UpstreamFailureError(
      `Model output size ${outputSizeBytes} bytes exceeded the backend limit of ${env.outputMaxBytes} bytes.`,
    );
  }
}

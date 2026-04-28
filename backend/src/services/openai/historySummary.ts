import type { ResponseFormatTextJSONSchemaConfig } from 'openai/resources/responses/responses';
import { z } from 'zod';
import {
  HISTORY_SUMMARY_MAX_CHARS,
} from '@kitto-openui/shared/builderApiContract.js';
import type { AppEnv } from '#backend/env.js';
import { UpstreamFailureError } from '#backend/errors/publicError.js';
import { getClient } from './client.js';
import { extractResponseText } from './streaming.js';

const historySummaryEnvelopeSchema = z
  .object({
    historySummary: z.string().max(HISTORY_SUMMARY_MAX_CHARS),
  })
  .strict();

export interface HistorySummaryRequest {
  historySummary?: string;
  previousChangeSummaries: string[];
  previousUserMessages: string[];
}

export interface HistorySummaryEnvelope {
  historySummary: string;
}

function createHistorySummaryJsonSchema() {
  const jsonSchema = z.toJSONSchema(historySummaryEnvelopeSchema);

  delete jsonSchema.$schema;
  return jsonSchema;
}

const historySummaryEnvelopeFormat: ResponseFormatTextJSONSchemaConfig = {
  type: 'json_schema',
  name: 'kitto_history_summary',
  strict: true,
  schema: createHistorySummaryJsonSchema(),
};

function escapePromptDataBlockContent(content: string) {
  return content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function buildPromptDataBlock(tagName: string, content: string) {
  return `<${tagName}>\n${escapePromptDataBlockContent(content)}\n</${tagName}>`;
}

function buildHistorySummaryInput(request: HistorySummaryRequest) {
  return [
    'Summarize only older user requests and committed change summaries that are about to be dropped.',
    'Keep durable intent, removed features, and constraints.',
    'Do not include OpenUI source.',
    'Do not include runtime preview data.',
    `Return historySummary under ${HISTORY_SUMMARY_MAX_CHARS} chars.`,
    request.historySummary ? buildPromptDataBlock('old_history_summary', request.historySummary) : null,
    request.previousUserMessages.length > 0
      ? buildPromptDataBlock('old_previous_user_messages', JSON.stringify(request.previousUserMessages))
      : null,
    request.previousChangeSummaries.length > 0
      ? buildPromptDataBlock('old_previous_change_summaries', JSON.stringify(request.previousChangeSummaries))
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function parseHistorySummaryEnvelope(rawModelText: unknown): HistorySummaryEnvelope {
  if (typeof rawModelText !== 'string') {
    throw new UpstreamFailureError('The model response did not include text output.');
  }

  const trimmedEnvelopeText = rawModelText.trim();

  if (!trimmedEnvelopeText) {
    throw new UpstreamFailureError('The model returned an empty history summary response.');
  }

  let parsedEnvelope: unknown;

  try {
    parsedEnvelope = JSON.parse(trimmedEnvelopeText);
  } catch {
    throw new UpstreamFailureError('The model returned malformed history summary output.');
  }

  const envelopeResult = historySummaryEnvelopeSchema.safeParse(parsedEnvelope);

  if (!envelopeResult.success) {
    throw new UpstreamFailureError('The model returned an invalid history summary envelope.');
  }

  return {
    historySummary: envelopeResult.data.historySummary.trim().slice(0, HISTORY_SUMMARY_MAX_CHARS),
  };
}

export async function generateHistorySummary(
  env: AppEnv,
  request: HistorySummaryRequest,
  signal?: AbortSignal,
): Promise<HistorySummaryEnvelope> {
  const client = getClient(env);
  const responseRequest = {
    model: env.OPENAI_MODEL,
    input: [
      {
        role: 'system' as const,
        content: [
          {
            type: 'input_text' as const,
            text: 'You compact older Kitto OpenUI chat context into durable, source-free notes for a future generation request.',
          },
        ],
      },
      {
        role: 'user' as const,
        content: [
          {
            type: 'input_text' as const,
            text: buildHistorySummaryInput(request),
          },
        ],
      },
    ],
    max_output_tokens: 512,
    temperature: 0,
    text: {
      format: historySummaryEnvelopeFormat,
    },
  };

  const response = await client.responses.create(responseRequest, {
    signal,
    timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
  });

  return parseHistorySummaryEnvelope(extractResponseText(response));
}

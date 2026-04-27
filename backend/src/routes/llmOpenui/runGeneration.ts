import type { Context } from 'hono';
import type { AppEnv } from '#backend/env.js';
import {
  detectPromptAwareQualityIssues,
  getSummaryQualityWarning,
  getOpenUiTemperature,
  shouldExcludeSummaryFromLlmContext,
} from '#backend/prompts/openui.js';
import { assertModelOutputWithinLimit } from '#backend/services/openai/envelope.js';
import { generateOpenUiSource, type OpenUiGenerationEnvelope } from '#backend/services/openai.js';
import { mapToPublicError } from './mapToPublicError.js';
import { parseLlmRequest, type PreparedLlmInvocation } from './requestSchema.js';
import type { LlmOpenUiTelemetry } from './telemetry.js';

const GENERATE_SCOPE = 'POST /api/llm/generate';

interface RunGenerationOptions {
  onCompletedGeneration?: (invocation: PreparedLlmInvocation) => void;
}

export function createLlmResponsePayload(
  env: AppEnv,
  invocation: PreparedLlmInvocation,
  responseEnvelope: OpenUiGenerationEnvelope,
) {
  const { source, summary } = responseEnvelope;
  const summaryWarning = getSummaryQualityWarning(summary);

  assertModelOutputWithinLimit(source, env);

  return {
    compaction: invocation.compaction,
    model: env.OPENAI_MODEL,
    qualityIssues: detectPromptAwareQualityIssues(
      source,
      invocation.request.prompt,
      invocation.request.currentSource,
      invocation.request.mode,
    ),
    source,
    summary,
    summaryWarning,
    summaryExcludeFromLlmContext: shouldExcludeSummaryFromLlmContext(summary) || undefined,
    temperature: getOpenUiTemperature(invocation.request.mode),
  };
}

export async function runGeneration(
  context: Context,
  env: AppEnv,
  telemetry: LlmOpenUiTelemetry,
  options: RunGenerationOptions = {},
) {
  try {
    const invocation = await parseLlmRequest(context, env, telemetry);
    const responseEnvelope = await generateOpenUiSource(env, invocation.request, context.req.raw.signal, {
      compactedRequestBytes: invocation.compactedRequestBytes,
      omittedChatMessages: invocation.omittedChatMessages,
      requestBytes: invocation.requestBytes,
      requestId: invocation.requestId,
    });
    const responsePayload = createLlmResponsePayload(env, invocation, responseEnvelope);

    telemetry.recordModelResponse(invocation.requestId);
    options.onCompletedGeneration?.(invocation);

    return context.json(responsePayload);
  } catch (error) {
    const publicError = mapToPublicError(error, GENERATE_SCOPE);
    return context.json(publicError, publicError.status);
  }
}

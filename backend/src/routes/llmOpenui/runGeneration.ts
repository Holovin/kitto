import type { Context } from 'hono';
import type { AppEnv } from '../../env.js';
import {
  detectPromptAwareQualityIssues,
  getOpenUiTemperature,
  shouldExcludeSummaryFromLlmContext,
} from '../../prompts/openui.js';
import { assertModelOutputWithinLimit } from '../../services/openai/envelope.js';
import { generateOpenUiSource, type OpenUiGenerationEnvelope } from '../../services/openai.js';
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

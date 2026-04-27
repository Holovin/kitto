import type { Context } from 'hono';
import { ZodError } from 'zod';
import {
  createBuilderLlmRequestSchema,
  createCommitTelemetrySchema,
  type BuilderCommitTelemetryRequest,
} from '@kitto-openui/shared/builderApiContract.js';
import type { AppEnv } from '#backend/env.js';
import { RequestValidationError } from '#backend/errors/publicError.js';
import { normalizeHeaderValue, parsePositiveIntegerHeader } from '#backend/httpHeaders.js';
import { getByteLength } from '#backend/limits.js';
import {
  compactPromptBuildChatHistory,
  filterPromptBuildChatHistory,
  type PromptBuildRequest,
  type PromptBuildValidationIssue,
  type RawPromptBuildChatHistoryMessage,
} from '#backend/prompts/openui.js';
import { getRequestIdFromContext } from '#backend/requestMetadata.js';
import type { IntakeFailureRecorder } from './telemetry.js';
import {
  AUTOMATIC_REPAIR_ATTEMPT_HEADER,
  AUTOMATIC_REPAIR_FOR_HEADER,
  AUTOMATIC_REPAIR_HEADER,
} from './transportHeaders.js';

export interface LlmRequestCompaction {
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

interface RawParsedLlmRequest {
  chatHistory: RawPromptBuildChatHistoryMessage[];
  currentSource: string;
  invalidDraft?: string;
  mode: 'initial' | 'repair';
  parentRequestId?: string;
  prompt: string;
  previousSource?: string;
  repairAttemptNumber?: number;
  validationIssues?: PromptBuildValidationIssue[];
}

export interface PreparedLlmInvocation {
  compaction?: LlmRequestCompaction;
  compactedRequestBytes: number;
  omittedChatMessages: number;
  request: PromptBuildRequest;
  requestBytes: number;
  requestId: string;
}

export type ParsedCommitTelemetryRequest = BuilderCommitTelemetryRequest;

interface CompactedLlmRequest {
  compaction?: LlmRequestCompaction;
  request: PromptBuildRequest;
}

const commitTelemetrySchema = createCommitTelemetrySchema();

function createLlmRequestSchema(env: AppEnv) {
  return createBuilderLlmRequestSchema({
    chatMessageMaxChars: env.LLM_USER_PROMPT_MAX_CHARS,
    promptMaxChars: env.LLM_USER_PROMPT_MAX_CHARS,
    sourceMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
  });
}

function sanitizeLlmRequest(request: RawParsedLlmRequest): PromptBuildRequest {
  return {
    ...request,
    chatHistory: filterPromptBuildChatHistory(request.chatHistory),
  };
}

function getRequestSizeBytes(request: PromptBuildRequest) {
  return getByteLength(JSON.stringify(request));
}

function createAutomaticRepairMetadataError() {
  return new RequestValidationError('Automatic repair transport metadata did not match the request body.', 400, {
    publicMessage: 'The request payload is invalid.',
  });
}

async function validateAutomaticRepairTransportMetadata({
  context,
  intakeRecorder,
  parsedBody,
  request,
  requestBytes,
  requestId,
}: {
  context: Context;
  intakeRecorder: IntakeFailureRecorder;
  parsedBody: unknown;
  request: PromptBuildRequest;
  requestBytes: number;
  requestId: string;
}) {
  if (context.req.header(AUTOMATIC_REPAIR_HEADER) !== '1') {
    return;
  }

  const parentRequestId = normalizeHeaderValue(context.req.header(AUTOMATIC_REPAIR_FOR_HEADER));
  const repairAttemptNumber = parsePositiveIntegerHeader(context.req.header(AUTOMATIC_REPAIR_ATTEMPT_HEADER));

  if (
    request.mode !== 'repair' ||
    !request.parentRequestId ||
    request.parentRequestId !== parentRequestId ||
    !request.repairAttemptNumber ||
    request.repairAttemptNumber !== repairAttemptNumber
  ) {
    const metadataError = createAutomaticRepairMetadataError();

    await intakeRecorder.recordIntake({
      error: metadataError,
      partialBody: parsedBody,
      requestBytes,
      requestId,
    });
    throw metadataError;
  }
}

function compactLlmRequest(request: PromptBuildRequest, env: AppEnv): CompactedLlmRequest {
  const compactedHistory = compactPromptBuildChatHistory(request.chatHistory, {
    getSizeBytes: (chatHistory) =>
      getRequestSizeBytes({
        ...request,
        chatHistory,
      }),
    maxBytes: env.LLM_REQUEST_MAX_BYTES,
    maxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
  });
  const compactedRequest: PromptBuildRequest = {
    ...request,
    chatHistory: compactedHistory.chatHistory,
  };

  return {
    compaction:
      compactedHistory.omittedChatMessages > 0
        ? {
            compactedByBytes: compactedHistory.compactedByBytes,
            compactedByItemLimit: compactedHistory.compactedByItemLimit,
            omittedChatMessages: compactedHistory.omittedChatMessages,
          }
        : undefined,
    request: compactedRequest,
  };
}

export async function parseLlmRequest(
  context: Context,
  env: AppEnv,
  intakeRecorder: IntakeFailureRecorder,
): Promise<PreparedLlmInvocation> {
  const requestId = getRequestIdFromContext(context);
  const rawBody = await context.req.text();
  const requestBytes = getByteLength(rawBody);
  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    const parseError = new RequestValidationError('Request body could not be parsed as JSON.', 400, {
      publicMessage: 'Request body must be valid JSON.',
    });

    await intakeRecorder.recordIntake({
      error: parseError,
      requestBytes,
      requestId,
    });
    throw parseError;
  }

  let request: PromptBuildRequest;

  try {
    request = sanitizeLlmRequest(createLlmRequestSchema(env).parse(parsedBody));
  } catch (error) {
    if (error instanceof ZodError) {
      await intakeRecorder.recordIntake({
        error,
        partialBody: parsedBody,
        requestBytes,
        requestId,
      });
    }

    throw error;
  }

  await validateAutomaticRepairTransportMetadata({
    context,
    intakeRecorder,
    parsedBody,
    request,
    requestBytes,
    requestId,
  });

  const compactedRequest = compactLlmRequest(request, env);
  const compactedRequestBytes = getRequestSizeBytes(compactedRequest.request);
  const omittedChatMessages = compactedRequest.compaction?.omittedChatMessages ?? 0;

  if (compactedRequestBytes > env.LLM_REQUEST_MAX_BYTES) {
    const compactionError = new RequestValidationError(
      `Compacted request still exceeded the safe request limit of ${env.LLM_REQUEST_MAX_BYTES} bytes.`,
      413,
      {
        publicMessage: 'Request body is too large to process safely.',
      },
    );

    await intakeRecorder.recordIntake({
      compactedRequestBytes,
      omittedChatMessages,
      error: compactionError,
      partialBody: parsedBody,
      requestBytes,
      requestId,
    });
    throw compactionError;
  }

  return {
    ...compactedRequest,
    compactedRequestBytes,
    omittedChatMessages,
    requestBytes,
    requestId,
  };
}

export async function parseCommitTelemetryRequest(context: Context): Promise<ParsedCommitTelemetryRequest> {
  const rawBody = await context.req.text();
  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('Request body could not be parsed as JSON.', 400, {
      publicMessage: 'Request body must be valid JSON.',
    });
  }

  return commitTelemetrySchema.parse(parsedBody);
}

import type { Context } from 'hono';
import { ZodError, z } from 'zod';
import type { AppEnv } from '#backend/env.js';
import { RequestValidationError } from '#backend/errors/publicError.js';
import { getByteLength, MAX_REPAIR_VALIDATION_ISSUES } from '#backend/limits.js';
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

export interface ParsedCommitTelemetryRequest {
  commitSource: 'fallback' | 'streaming';
  committed: boolean;
  qualityWarnings: string[];
  repairOutcome?: 'failed' | 'fixed';
  requestId: string;
  validationIssues: string[];
}

interface CompactedLlmRequest {
  compaction?: LlmRequestCompaction;
  request: PromptBuildRequest;
}

const stateReferenceNameSchema = z.string().trim().min(1).max(200).regex(/^\$[A-Za-z_][\w$]*$/);

const undefinedStateReferenceContextSchema = z.object({
  exampleInitializer: z.string().max(1_000).optional(),
  refName: stateReferenceNameSchema,
});

const stalePersistedQueryContextSchema = z.object({
  statementId: z.string().trim().min(1).max(200),
  suggestedQueryRefs: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_REPAIR_VALIDATION_ISSUES),
});

const optionsShapeContextSchema = z.object({
  groupId: z.string().trim().min(1).max(200),
  invalidValues: z.array(z.union([z.string().max(1_000), z.number().finite()])).min(1).max(MAX_REPAIR_VALIDATION_ISSUES),
});

const validationIssueContextSchema = z.union([
  undefinedStateReferenceContextSchema,
  stalePersistedQueryContextSchema,
  optionsShapeContextSchema,
]);

const validationIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(200),
    context: validationIssueContextSchema.optional(),
    message: z.string().trim().min(1).max(2_000),
    source: z.enum(['mutation', 'parser', 'quality', 'query', 'runtime']).optional(),
    statementId: z.string().trim().min(1).max(200).optional(),
    suggestion: z
      .object({
        kind: z.literal('replace-text'),
        from: z.string().max(1_000),
        to: z.string().max(1_000),
      })
      .optional(),
  })
  .superRefine((issue, context) => {
    if (issue.code === 'undefined-state-reference') {
      if (!issue.context || !('refName' in issue.context)) {
        context.addIssue({
          code: 'custom',
          message: 'undefined-state-reference issues require structured context.',
          path: ['context'],
        });
      }

      return;
    }

    if (issue.code === 'quality-stale-persisted-query') {
      if (!issue.context || !('suggestedQueryRefs' in issue.context)) {
        context.addIssue({
          code: 'custom',
          message: 'quality-stale-persisted-query issues require structured context.',
          path: ['context'],
        });
      }

      return;
    }

    if (issue.code === 'quality-options-shape') {
      if (!issue.context || !('invalidValues' in issue.context)) {
        context.addIssue({
          code: 'custom',
          message: 'quality-options-shape issues require structured context.',
          path: ['context'],
        });
      }

      return;
    }

    if (issue.context) {
      context.addIssue({
        code: 'custom',
        message: 'Validation issue context is not supported for this issue code.',
        path: ['context'],
      });
    }
  });

const commitTelemetrySchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  qualityWarnings: z.array(z.string().trim().min(1).max(200)).max(MAX_REPAIR_VALIDATION_ISSUES).default([]),
  validationIssues: z.array(z.string().trim().min(1).max(200)).max(MAX_REPAIR_VALIDATION_ISSUES).default([]),
  committed: z.boolean(),
  commitSource: z.enum(['streaming', 'fallback']),
  repairOutcome: z.enum(['failed', 'fixed']).optional(),
});

function createLlmRequestSchema(env: AppEnv) {
  const baseLlmRequestSchema = z.object({
    prompt: z
      .string()
      .min(1, 'Prompt must not be empty.')
      .max(env.LLM_USER_PROMPT_MAX_CHARS, `Prompt is too large. Limit: ${env.LLM_USER_PROMPT_MAX_CHARS} characters.`),
    currentSource: z.string().default(''),
    parentRequestId: z.string().trim().min(1).max(200).optional(),
    repairAttemptNumber: z.coerce.number().int().positive().optional(),
    validationIssues: z.array(validationIssueSchema).max(MAX_REPAIR_VALIDATION_ISSUES).optional(),
    chatHistory: z
      .array(
        z.object({
          role: z.enum(['assistant', 'system', 'user']),
          content: z.string(),
          excludeFromLlmContext: z.boolean().optional(),
        }),
      )
      .default([]),
  });

  const requestSchema = z.discriminatedUnion('mode', [
    baseLlmRequestSchema.extend({
      invalidDraft: z.string().optional(),
      mode: z.literal('initial'),
    }),
    baseLlmRequestSchema.extend({
      invalidDraft: z.string(),
      mode: z.literal('repair'),
    }),
  ]);

  return z.preprocess((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !('mode' in value)) {
      return {
        ...value,
        mode: 'initial',
      };
    }

    return value;
  }, requestSchema);
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

function normalizeHeaderValue(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
}

function parsePositiveIntegerHeader(value: string | null | undefined) {
  const normalizedValue = normalizeHeaderValue(value);

  if (!normalizedValue || !/^[1-9]\d*$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);
  return Number.isSafeInteger(parsedValue) ? parsedValue : null;
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

import type { Context } from 'hono';
import { ZodError, z } from 'zod';
import type { AppEnv } from '../../env.js';
import { RequestValidationError } from '../../errors/publicError.js';
import { getByteLength, MAX_REPAIR_VALIDATION_ISSUES } from '../../limits.js';
import {
  filterPromptBuildChatHistory,
  retainPromptBuildChatHistory,
  retainPromptBuildChatHistoryTail,
  type PromptBuildRequest,
  type PromptBuildValidationIssue,
  type RawPromptBuildChatHistoryMessage,
} from '../../prompts/openui.js';
import { getRequestIdFromContext } from '../../requestMetadata.js';
import type { IntakeFailureRecorder } from './telemetry.js';

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
  requestId: string;
  validationIssues: string[];
}

interface CompactedLlmRequest {
  compaction?: LlmRequestCompaction;
  request: PromptBuildRequest;
}

const validationIssueSchema = z.object({
  code: z.string().trim().min(1).max(200),
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
});

const commitTelemetrySchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  validationIssues: z.array(z.string().trim().min(1).max(200)).max(MAX_REPAIR_VALIDATION_ISSUES).default([]),
  committed: z.boolean(),
  commitSource: z.enum(['streaming', 'fallback']),
});

function createLlmRequestSchema(env: AppEnv) {
  return z.object({
    prompt: z
      .string()
      .min(1, 'Prompt must not be empty.')
      .max(env.LLM_PROMPT_MAX_CHARS, `Prompt is too large. Limit: ${env.LLM_PROMPT_MAX_CHARS} characters.`),
    currentSource: z.string().default(''),
    invalidDraft: z.string().optional(),
    mode: z.enum(['initial', 'repair']).default('initial'),
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

function compactLlmRequest(request: PromptBuildRequest, env: AppEnv): CompactedLlmRequest {
  let compactedByBytes = false;
  let compactedByItemLimit = false;
  let omittedChatMessages = 0;
  let chatHistory = filterPromptBuildChatHistory(request.chatHistory);

  if (chatHistory.length > env.LLM_CHAT_HISTORY_MAX_ITEMS) {
    const retainedChatHistory = retainPromptBuildChatHistory(chatHistory, env.LLM_CHAT_HISTORY_MAX_ITEMS);
    omittedChatMessages += chatHistory.length - retainedChatHistory.length;
    compactedByItemLimit = true;
    chatHistory = retainedChatHistory;
  }

  let compactedRequest: PromptBuildRequest = {
    ...request,
    chatHistory,
  };

  if (getRequestSizeBytes(compactedRequest) > env.LLM_REQUEST_MAX_BYTES && compactedRequest.chatHistory.length > 0) {
    compactedByBytes = true;
    const chatHistoryForCompaction = filterPromptBuildChatHistory(compactedRequest.chatHistory);
    let maximumRetainedTailCount: number | null = null;
    let lowerBound = 0;
    let upperBound = chatHistoryForCompaction.length;

    // Request size grows monotonically as we retain a larger newest-tail window.
    while (lowerBound <= upperBound) {
      const retainedTailCount = Math.floor((lowerBound + upperBound) / 2);
      const retainedChatHistory = retainPromptBuildChatHistoryTail(chatHistoryForCompaction, retainedTailCount);
      const candidateRequest = {
        ...compactedRequest,
        chatHistory: retainedChatHistory,
      };

      if (getRequestSizeBytes(candidateRequest) <= env.LLM_REQUEST_MAX_BYTES) {
        maximumRetainedTailCount = retainedTailCount;
        lowerBound = retainedTailCount + 1;
        continue;
      }

      upperBound = retainedTailCount - 1;
    }

    const retainedChatHistory =
      maximumRetainedTailCount === null ? [] : retainPromptBuildChatHistoryTail(chatHistoryForCompaction, maximumRetainedTailCount);

    omittedChatMessages += chatHistoryForCompaction.length - retainedChatHistory.length;
    compactedRequest = {
      ...compactedRequest,
      chatHistory: retainedChatHistory,
    };
  }

  return {
    compaction:
      omittedChatMessages > 0
        ? {
            compactedByBytes,
            compactedByItemLimit,
            omittedChatMessages,
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

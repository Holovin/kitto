import { z } from 'zod';

export const DEFAULT_MAX_REPAIR_VALIDATION_ISSUES = 20;

export const BUILDER_CHAT_MESSAGE_ROLES = ['assistant', 'system', 'user'] as const;
export const BUILDER_CONVERSATION_CHAT_MESSAGE_ROLES = ['assistant', 'user'] as const;
export const BUILDER_LLM_REQUEST_MODES = ['initial', 'repair'] as const;
export const BUILDER_COMMIT_SOURCES = ['fallback', 'streaming'] as const;
export const BUILDER_COMMIT_REPAIR_OUTCOMES = ['failed', 'fixed'] as const;
export const OPENUI_VALIDATION_ISSUE_SOURCES = ['mutation', 'parser', 'quality', 'query', 'runtime'] as const;
export const BUILDER_QUALITY_ISSUE_SEVERITIES = ['blocking-quality', 'fatal-quality', 'soft-warning'] as const;

export type PromptBuildChatHistoryRole = (typeof BUILDER_CHAT_MESSAGE_ROLES)[number];
export type PromptConversationChatHistoryRole = (typeof BUILDER_CONVERSATION_CHAT_MESSAGE_ROLES)[number];
export type BuilderLlmRequestMode = (typeof BUILDER_LLM_REQUEST_MODES)[number];
export type BuilderCommitSource = (typeof BUILDER_COMMIT_SOURCES)[number];
export type BuilderCommitRepairOutcome = (typeof BUILDER_COMMIT_REPAIR_OUTCOMES)[number];
export type PromptBuildValidationIssueSource = (typeof OPENUI_VALIDATION_ISSUE_SOURCES)[number];
export type BuilderQualityIssueSeverity = (typeof BUILDER_QUALITY_ISSUE_SEVERITIES)[number];
export type BuilderRequestId = string;

export interface PromptBuildValidationIssueSuggestion {
  kind: 'replace-text';
  from: string;
  to: string;
}

export interface PromptBuildUndefinedStateReferenceIssueContext {
  exampleInitializer?: string;
  refName: string;
}

export interface PromptBuildStalePersistedQueryIssueContext {
  statementId: string;
  suggestedQueryRefs: string[];
}

export interface PromptBuildOptionsShapeIssueContext {
  groupId: string;
  invalidValues: Array<number | string>;
}

export type PromptBuildValidationIssueContext =
  | PromptBuildOptionsShapeIssueContext
  | PromptBuildStalePersistedQueryIssueContext
  | PromptBuildUndefinedStateReferenceIssueContext;

export interface RawPromptBuildChatHistoryMessage {
  content: string;
  excludeFromLlmContext?: boolean;
  role: PromptBuildChatHistoryRole;
}

export interface PromptBuildChatHistoryMessage {
  content: string;
  role: PromptConversationChatHistoryRole;
}

export interface PromptBuildValidationIssue {
  code: string;
  context?: PromptBuildValidationIssueContext;
  message: string;
  source?: PromptBuildValidationIssueSource;
  statementId?: string;
  suggestion?: PromptBuildValidationIssueSuggestion;
}

export interface PromptBuildRequest {
  chatHistory: RawPromptBuildChatHistoryMessage[];
  currentSource: string;
  invalidDraft?: string;
  mode: BuilderLlmRequestMode;
  parentRequestId?: string;
  prompt: string;
  repairAttemptNumber?: number;
  validationIssues?: PromptBuildValidationIssue[];
}

export type BuilderLlmChatMessage = RawPromptBuildChatHistoryMessage;
export type BuilderParseIssueSuggestion = PromptBuildValidationIssueSuggestion;
export type BuilderUndefinedStateReferenceIssueContext = PromptBuildUndefinedStateReferenceIssueContext;
export type BuilderStalePersistedQueryIssueContext = PromptBuildStalePersistedQueryIssueContext;
export type BuilderOptionsShapeIssueContext = PromptBuildOptionsShapeIssueContext;
export type BuilderParseIssueContext = PromptBuildValidationIssueContext;
export type BuilderParseIssue = PromptBuildValidationIssue;
export type BuilderLlmRequest = PromptBuildRequest;

export interface BuilderQualityIssue extends BuilderParseIssue {
  severity: BuilderQualityIssueSeverity;
}

export interface BuilderLlmRequestCompaction {
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

export interface BuilderLlmResponse {
  compaction?: BuilderLlmRequestCompaction;
  model: string;
  qualityIssues?: BuilderQualityIssue[];
  source: string;
  summary?: string;
  summaryExcludeFromLlmContext?: boolean;
  temperature: number;
}

export interface BuilderCommitTelemetryRequest {
  commitSource: BuilderCommitSource;
  committed: boolean;
  qualityWarnings: string[];
  repairOutcome?: BuilderCommitRepairOutcome;
  requestId: string;
  validationIssues: string[];
}

export interface PromptInfoToolSpec {
  description: string;
  name: string;
  signature: string;
}

export interface CreateBuilderLlmRequestSchemaOptions {
  chatMessageMaxChars: number;
  maxValidationIssues?: number;
  promptMaxChars: number;
  sourceMaxChars: number;
}

export interface CreateCommitTelemetrySchemaOptions {
  maxValidationIssues?: number;
}

const stateReferenceNameSchema = z.string().trim().min(1).max(200).regex(/^\$[A-Za-z_][\w$]*$/);

const undefinedStateReferenceContextSchema = z.object({
  exampleInitializer: z.string().max(1_000).optional(),
  refName: stateReferenceNameSchema,
});

function createValidationIssueSchema(maxValidationIssues: number) {
  const stalePersistedQueryContextSchema = z.object({
    statementId: z.string().trim().min(1).max(200),
    suggestedQueryRefs: z.array(z.string().trim().min(1).max(200)).min(1).max(maxValidationIssues),
  });

  const optionsShapeContextSchema = z.object({
    groupId: z.string().trim().min(1).max(200),
    invalidValues: z.array(z.union([z.string().max(1_000), z.number().finite()])).min(1).max(maxValidationIssues),
  });

  const validationIssueContextSchema = z.union([
    undefinedStateReferenceContextSchema,
    stalePersistedQueryContextSchema,
    optionsShapeContextSchema,
  ]);

  return z
    .object({
      code: z.string().trim().min(1).max(200),
      context: validationIssueContextSchema.optional(),
      message: z.string().trim().min(1).max(2_000),
      source: z.enum(OPENUI_VALIDATION_ISSUE_SOURCES).optional(),
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
}

export function createBuilderLlmRequestSchema({
  chatMessageMaxChars,
  maxValidationIssues = DEFAULT_MAX_REPAIR_VALIDATION_ISSUES,
  promptMaxChars,
  sourceMaxChars,
}: CreateBuilderLlmRequestSchemaOptions) {
  const validationIssueSchema = createValidationIssueSchema(maxValidationIssues);
  const currentSourceSchema = z
    .string()
    .max(sourceMaxChars, `Current source is too large. Limit: ${sourceMaxChars} characters.`);
  const invalidDraftSchema = z
    .string()
    .max(sourceMaxChars, `Invalid draft is too large. Limit: ${sourceMaxChars} characters.`);
  const baseLlmRequestSchema = z.object({
    prompt: z
      .string()
      .min(1, 'Prompt must not be empty.')
      .max(promptMaxChars, `Prompt is too large. Limit: ${promptMaxChars} characters.`),
    currentSource: currentSourceSchema.default(''),
    parentRequestId: z.string().trim().min(1).max(200).optional(),
    repairAttemptNumber: z.coerce.number().int().positive().optional(),
    validationIssues: z.array(validationIssueSchema).max(maxValidationIssues).optional(),
    chatHistory: z
      .array(
        z.object({
          role: z.enum(BUILDER_CHAT_MESSAGE_ROLES),
          content: z
            .string()
            .max(chatMessageMaxChars, `Chat history message is too large. Limit: ${chatMessageMaxChars} characters.`),
          excludeFromLlmContext: z.boolean().optional(),
        }),
      )
      .default([]),
  });

  const requestSchema = z.discriminatedUnion('mode', [
    baseLlmRequestSchema.extend({
      invalidDraft: invalidDraftSchema.optional(),
      mode: z.literal('initial'),
    }),
    baseLlmRequestSchema.extend({
      invalidDraft: invalidDraftSchema,
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

export function createCommitTelemetrySchema({
  maxValidationIssues = DEFAULT_MAX_REPAIR_VALIDATION_ISSUES,
}: CreateCommitTelemetrySchemaOptions = {}) {
  return z.object({
    requestId: z.string().trim().min(1).max(200),
    qualityWarnings: z.array(z.string().trim().min(1).max(200)).max(maxValidationIssues).default([]),
    validationIssues: z.array(z.string().trim().min(1).max(200)).max(maxValidationIssues).default([]),
    committed: z.boolean(),
    commitSource: z.enum(BUILDER_COMMIT_SOURCES),
    repairOutcome: z.enum(BUILDER_COMMIT_REPAIR_OUTCOMES).optional(),
  });
}

export function getPromptBuildValidationIssueCodes(validationIssues?: PromptBuildValidationIssue[]) {
  const codes = (validationIssues ?? [])
    .map((issue) => (typeof issue.code === 'string' ? issue.code.trim() : ''))
    .filter((code): code is string => code.length > 0);

  return codes.length > 0 ? [...new Set(codes)] : [];
}

import { z } from 'zod';

export const DEFAULT_MAX_REPAIR_VALIDATION_ISSUES = 20;

export const BUILDER_CHAT_MESSAGE_ROLES = ['assistant', 'system', 'user'] as const;
export const BUILDER_CONVERSATION_CHAT_MESSAGE_ROLES = ['assistant', 'user'] as const;
export const BUILDER_LLM_REQUEST_MODES = ['initial', 'repair'] as const;
export const BUILDER_COMMIT_SOURCES = ['fallback', 'streaming'] as const;
export const BUILDER_COMMIT_REPAIR_OUTCOMES = ['failed', 'fixed'] as const;
export const OPENUI_VALIDATION_ISSUE_SOURCES = ['mutation', 'parser', 'quality', 'query', 'runtime'] as const;
export const BUILDER_QUALITY_ISSUE_SEVERITIES = ['blocking-quality', 'fatal-quality', 'soft-warning'] as const;
export const CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE =
  'The current app definition is too large to safely modify in one request. Export the definition or simplify/reset the app before continuing.';

export type PromptBuildChatHistoryRole = (typeof BUILDER_CHAT_MESSAGE_ROLES)[number];
export type PromptConversationChatHistoryRole = (typeof BUILDER_CONVERSATION_CHAT_MESSAGE_ROLES)[number];
export type BuilderLlmRequestMode = (typeof BUILDER_LLM_REQUEST_MODES)[number];
export type BuilderCommitSource = (typeof BUILDER_COMMIT_SOURCES)[number];
export type BuilderCommitRepairOutcome = (typeof BUILDER_COMMIT_REPAIR_OUTCOMES)[number];
export type PromptBuildValidationIssueSource = (typeof OPENUI_VALIDATION_ISSUE_SOURCES)[number];
export type BuilderQualityIssueSeverity = (typeof BUILDER_QUALITY_ISSUE_SEVERITIES)[number];
declare const builderRequestIdBrand: unique symbol;
export type BuilderRequestId = string & { readonly [builderRequestIdBrand]: 'BuilderRequestId' };

export function toBuilderRequestId(value: string): BuilderRequestId {
  return value as BuilderRequestId;
}

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

export interface PromptBuildMissingControlShowcaseComponentsIssueContext {
  missingComponents: string[];
}

export interface PromptBuildEmptyInitialRenderIssueContext {
  screenCount: number;
}

export type PromptBuildValidationIssueContext =
  | PromptBuildEmptyInitialRenderIssueContext
  | PromptBuildMissingControlShowcaseComponentsIssueContext
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
  severity?: BuilderQualityIssueSeverity;
  source?: PromptBuildValidationIssueSource;
  statementId?: string;
  suggestion?: PromptBuildValidationIssueSuggestion;
}

export interface PromptBuildRequest {
  appMemory?: AppMemory;
  chatHistory?: RawPromptBuildChatHistoryMessage[];
  currentSource: string;
  historySummary?: string;
  invalidDraft?: string;
  mode: BuilderLlmRequestMode;
  parentRequestId?: string;
  previousChangeSummaries?: string[];
  previousUserMessages?: string[];
  previousSource?: string;
  prompt: string;
  repairAttemptNumber?: number;
  validationIssues?: PromptBuildValidationIssue[];
}

export interface BuilderQualityIssue extends PromptBuildValidationIssue {
  severity: BuilderQualityIssueSeverity;
  source: 'quality';
}

export interface BuilderLlmRequestCompaction {
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

export interface BudgetDecisionSection {
  chars: number;
  included: boolean;
  name: string;
  protected: boolean;
  reason?: string;
}

export interface BudgetDecision {
  currentSourceChars: number;
  currentSourceIncluded: boolean;
  currentSourceProtected: true;
  droppedSections: string[];
  sections: BudgetDecisionSection[];
}

export const APP_MEMORY_VERSION = 1;
export const APP_MEMORY_MAX_CHARS = 4_096;
export const APP_MEMORY_ARRAY_MAX_ITEMS = 8;
export const APP_MEMORY_ITEM_MAX_CHARS = 180;
export const APP_MEMORY_SUMMARY_MAX_CHARS = 1_800;
export const PREVIOUS_USER_MESSAGES_MAX_ITEMS = 5;
export const PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS = 4_096;
export const PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS = 5;
export const PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS = 1_024;
export const HISTORY_SUMMARY_MAX_CHARS = 512;
export const VALIDATION_ISSUES_MAX_CHARS = 4_096;
export const SELECTED_EXAMPLES_MAX_CHARS = 2_500;
export const CURRENT_SOURCE_ITEMS_MAX_CHARS = 3_000;

export const appMemorySchema = z
  .object({
    version: z.literal(APP_MEMORY_VERSION),
    appSummary: z.string().max(APP_MEMORY_SUMMARY_MAX_CHARS),
    userPreferences: z.array(z.string().max(APP_MEMORY_ITEM_MAX_CHARS)).max(APP_MEMORY_ARRAY_MAX_ITEMS),
    avoid: z.array(z.string().max(APP_MEMORY_ITEM_MAX_CHARS)).max(APP_MEMORY_ARRAY_MAX_ITEMS),
  })
  .strict();

export type AppMemory = z.infer<typeof appMemorySchema>;

export const appMemoryInputSchema = z
  .object({
    version: z.literal(APP_MEMORY_VERSION),
    appSummary: z.string(),
    userPreferences: z.array(z.string()),
    avoid: z.array(z.string()),
  })
  .strict();

export function createEmptyAppMemory(): AppMemory {
  return {
    version: APP_MEMORY_VERSION,
    appSummary: '',
    userPreferences: [],
    avoid: [],
  };
}

function trimToMaxLength(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength).trim();
}

function normalizeAppMemoryArray(values: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmedValue = trimToMaxLength(value, APP_MEMORY_ITEM_MAX_CHARS);

    if (!trimmedValue || seen.has(trimmedValue)) {
      continue;
    }

    seen.add(trimmedValue);
    normalized.push(trimmedValue);

    if (normalized.length >= APP_MEMORY_ARRAY_MAX_ITEMS) {
      break;
    }
  }

  return normalized;
}

function getAppMemorySerializedChars(appMemory: AppMemory) {
  return JSON.stringify(appMemory).length;
}

function getTotalTextChars(values: string[]) {
  return values.reduce((total, value) => total + value.length, 0);
}

function createBoundedStringArraySchema(maxItems: number, maxTotalChars: number, label: string) {
  return z
    .array(z.string().trim().min(1).max(maxTotalChars))
    .max(maxItems)
    .superRefine((values, context) => {
      if (getTotalTextChars(values) <= maxTotalChars) {
        return;
      }

      context.addIssue({
        code: 'custom',
        message: `${label} are too large. Limit: ${maxTotalChars} total characters.`,
      });
    });
}

export function normalizeAppMemory(value: unknown): AppMemory {
  const result = appMemoryInputSchema.safeParse(value);

  if (!result.success) {
    return createEmptyAppMemory();
  }

  const normalizedMemory: AppMemory = {
    version: APP_MEMORY_VERSION,
    appSummary: trimToMaxLength(result.data.appSummary, APP_MEMORY_SUMMARY_MAX_CHARS),
    userPreferences: normalizeAppMemoryArray(result.data.userPreferences).slice(0, APP_MEMORY_ARRAY_MAX_ITEMS),
    avoid: normalizeAppMemoryArray(result.data.avoid).slice(0, APP_MEMORY_ARRAY_MAX_ITEMS),
  };
  const arrayKeys = ['userPreferences', 'avoid'] as const;
  let arrayTrimIndex = 0;

  while (getAppMemorySerializedChars(normalizedMemory) > APP_MEMORY_MAX_CHARS) {
    const key = arrayKeys[arrayTrimIndex % arrayKeys.length] ?? 'avoid';
    const array = normalizedMemory[key];

    if (array.length === 0 && normalizedMemory.userPreferences.length === 0 && normalizedMemory.avoid.length === 0) {
      break;
    }

    if (array.length > 0) {
      array.pop();
    }

    arrayTrimIndex += 1;
  }

  const extraChars = getAppMemorySerializedChars(normalizedMemory) - APP_MEMORY_MAX_CHARS;

  if (extraChars > 0 && normalizedMemory.appSummary.length > 0) {
    normalizedMemory.appSummary = trimToMaxLength(
      normalizedMemory.appSummary.slice(0, Math.max(0, normalizedMemory.appSummary.length - extraChars - 16)),
      APP_MEMORY_SUMMARY_MAX_CHARS,
    );
  }

  return normalizedMemory;
}

export interface BuilderLlmResponse {
  appMemory: AppMemory;
  budgetDecision?: BudgetDecision;
  changeSummary: string;
  compaction?: BuilderLlmRequestCompaction;
  model: string;
  qualityIssues?: BuilderQualityIssue[];
  source: string;
  summary: string;
  summaryExcludeFromLlmContext?: boolean;
  summaryWarning?: string;
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

export interface OpenUiPromptInfoToolSpec {
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

  const missingControlShowcaseComponentsContextSchema = z.object({
    missingComponents: z.array(z.string().trim().min(1).max(200)).min(1).max(maxValidationIssues),
  });

  const validationIssueContextSchema = z.union([
    undefinedStateReferenceContextSchema,
    stalePersistedQueryContextSchema,
    optionsShapeContextSchema,
    missingControlShowcaseComponentsContextSchema,
  ]);

  return z
    .object({
      code: z.string().trim().min(1).max(200),
      context: validationIssueContextSchema.optional(),
      message: z.string().trim().min(1).max(2_000),
      severity: z.enum(BUILDER_QUALITY_ISSUE_SEVERITIES).optional(),
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

      if (issue.code === 'quality-missing-control-showcase-components') {
        if (!issue.context || !('missingComponents' in issue.context)) {
          context.addIssue({
            code: 'custom',
            message: 'quality-missing-control-showcase-components issues require structured context.',
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
  chatMessageMaxChars: _chatMessageMaxChars,
  maxValidationIssues = DEFAULT_MAX_REPAIR_VALIDATION_ISSUES,
  promptMaxChars,
  sourceMaxChars,
}: CreateBuilderLlmRequestSchemaOptions) {
  const repairOnlyRequestKeys = ['invalidDraft', 'parentRequestId', 'repairAttemptNumber', 'validationIssues'] as const;
  const validationIssueSchema = createValidationIssueSchema(maxValidationIssues);
  const currentSourceSchema = z
    .string()
    .max(sourceMaxChars, CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE);
  const invalidDraftSchema = z
    .string()
    .max(sourceMaxChars, `Invalid draft is too large. Limit: ${sourceMaxChars} characters.`);
  const commonLlmRequestSchema = z.object({
    prompt: z
      .string()
      .min(1, 'Prompt must not be empty.')
      .max(promptMaxChars, `Prompt is too large. Limit: ${promptMaxChars} characters.`),
    appMemory: appMemorySchema.optional(),
    currentSource: currentSourceSchema.default(''),
    previousSource: currentSourceSchema.optional(),
    historySummary: z.string().trim().min(1).max(HISTORY_SUMMARY_MAX_CHARS).optional(),
    previousChangeSummaries: createBoundedStringArraySchema(
      PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS,
      PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
      'Previous change summaries',
    ).default([]),
    previousUserMessages: createBoundedStringArraySchema(
      PREVIOUS_USER_MESSAGES_MAX_ITEMS,
      PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
      'Previous user messages',
    ).default([]),
  });

  const requestSchema = z.discriminatedUnion('mode', [
    commonLlmRequestSchema.extend({
      invalidDraft: z.never().optional(),
      mode: z.literal('initial'),
      parentRequestId: z.never().optional(),
      repairAttemptNumber: z.never().optional(),
      validationIssues: z.never().optional(),
    }),
    commonLlmRequestSchema.extend({
      invalidDraft: invalidDraftSchema,
      mode: z.literal('repair'),
      parentRequestId: z.string().trim().min(1).max(200).optional(),
      repairAttemptNumber: z.coerce.number().int().positive().optional(),
      validationIssues: z.array(validationIssueSchema).max(maxValidationIssues).optional(),
    }),
  ]);

  const addLegacyInitialRequestMode = z.transform((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !('mode' in value)) {
      if (repairOnlyRequestKeys.some((key) => key in value)) {
        return value;
      }

      return {
        ...value,
        mode: 'initial',
      };
    }

    return value;
  });

  return addLegacyInitialRequestMode.pipe(requestSchema);
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
    .map((issue) => issue.code.trim())
    .filter((code): code is string => code.length > 0);

  return codes.length > 0 ? [...new Set(codes)] : [];
}

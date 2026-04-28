import type {
  BuilderCommitSource,
  BuilderLlmResponse,
  BuilderRequestId,
  AppMemory,
  OpenUiPromptInfoToolSpec,
  PromptBuildChatHistoryRole,
} from '@kitto-openui/shared/builderApiContract.js';

export { toBuilderRequestId } from '@kitto-openui/shared/builderApiContract.js';

export type {
  AppMemory,
  BuilderCommitRepairOutcome,
  BuilderCommitSource,
  RawPromptBuildChatHistoryMessage,
  PromptBuildRequest,
  BuilderLlmRequestCompaction,
  BuilderLlmRequestMode,
  BuilderLlmResponse,
  PromptBuildOptionsShapeIssueContext,
  PromptBuildValidationIssue,
  PromptBuildValidationIssueContext,
  PromptBuildValidationIssueSuggestion,
  BuilderQualityIssue,
  BuilderQualityIssueSeverity,
  BuilderRequestId,
  OpenUiPromptInfoToolSpec,
  PromptBuildStalePersistedQueryIssueContext,
  PromptBuildUndefinedStateReferenceIssueContext,
} from '@kitto-openui/shared/builderApiContract.js';

export type BuilderConnectionStatus = 'loading' | 'connected' | 'disconnected';
export type BuilderTabId = 'preview' | 'definition' | 'app-state';
type BuilderMessageRole = PromptBuildChatHistoryRole;
type BuilderMessageTone = 'default' | 'error' | 'info' | 'success';

export interface BuilderChatMessage {
  id: string;
  role: BuilderMessageRole;
  content: string;
  createdAt: string;
  excludeFromLlmContext?: boolean;
  isStreaming?: boolean;
  messageKey?: string;
  technicalDetails?: string;
  tone?: BuilderMessageTone;
}

export interface BuilderChatNotice {
  content: string;
  messageKey?: BuilderChatMessage['messageKey'];
  tone?: BuilderChatMessage['tone'];
}

export interface BuilderSnapshot {
  id: string;
  source: string;
  summary: string;
  changeSummary: string;
  appMemory?: AppMemory;
  createdAt: string;
  runtimeState: Record<string, unknown>;
  domainData: Record<string, unknown>;
  initialRuntimeState: Record<string, unknown>;
  initialDomainData: Record<string, unknown>;
  committedAt: string;
}

export interface BuilderDefinitionExport {
  version: 1;
  source: string;
  appMemory?: AppMemory;
  runtimeState: Record<string, unknown>;
  domainData: Record<string, unknown>;
  history: BuilderSnapshot[];
}

export interface BuilderGeneratedDraft
  extends Pick<
    BuilderLlmResponse,
    | 'appMemory'
    | 'changeSummary'
    | 'compaction'
    | 'qualityIssues'
    | 'source'
    | 'summary'
    | 'summaryExcludeFromLlmContext'
    | 'summaryWarning'
  > {
  commitSource: BuilderCommitSource;
  requestId: BuilderRequestId;
}

export interface BuilderConfigResponse {
  generation: {
    repairTemperature: number;
    temperature: number;
  };
  limits: {
    chatMessageMaxChars: number;
    chatHistoryMaxItems: number;
    promptMaxChars: number;
    requestMaxBytes: number;
    sourceMaxChars: number;
  };
  repair: {
    maxRepairAttempts: number;
    maxValidationIssues: number;
  };
  timeouts: {
    streamIdleTimeoutMs: number;
    streamMaxDurationMs: number;
  };
}

export interface HealthResponse {
  model: string;
  openaiConfigured: boolean;
  status: 'ok';
  timestamp: string;
}

export interface PromptInfoSystemPromptVariant {
  cacheKey: string;
  hash: string;
  id: string;
  intentVector: string;
  label: string;
  sampleRequest: string | null;
  text: string;
}

export interface PromptInfoIntentContextVariant {
  id: string;
  intentVector: string;
  label: string;
  sampleRequest: string | null;
  text: string;
}

export interface PromptsInfoResponse {
  config: {
    cacheKeyPrefix: string;
    maxOutputTokens: number;
    model: string;
    modelPromptMaxChars: number;
    outputMaxBytes: number;
    repairTemperature: number;
    requestMaxBytes: number;
    temperature: number;
    userPromptMaxChars: number;
  };
  envelopeSchema: Record<string, unknown>;
  intentContext: PromptInfoIntentContextVariant;
  intentContextVariants: PromptInfoIntentContextVariant[];
  repairPromptTemplate: string;
  systemPrompt: PromptInfoSystemPromptVariant;
  systemPromptVariants: PromptInfoSystemPromptVariant[];
  toolSpecs: OpenUiPromptInfoToolSpec[];
  requestPromptTemplate: string;
}

export type BuilderConnectionStatus = 'loading' | 'connected' | 'disconnected';
export type BuilderRequestId = string;
export type BuilderLlmRequestMode = 'initial' | 'repair';
export type BuilderTabId = 'preview' | 'definition' | 'app-state';
export type BuilderCommitSource = 'fallback' | 'streaming';
export type BuilderCommitRepairOutcome = 'failed' | 'fixed';
type BuilderMessageRole = 'assistant' | 'system' | 'user';
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

export interface BuilderLlmChatMessage {
  content: string;
  excludeFromLlmContext?: boolean;
  role: BuilderChatMessage['role'];
}

export interface BuilderSnapshot {
  source: string;
  runtimeState: Record<string, unknown>;
  domainData: Record<string, unknown>;
  initialRuntimeState: Record<string, unknown>;
  initialDomainData: Record<string, unknown>;
  committedAt: string;
}

export interface BuilderDefinitionExport {
  version: 1;
  source: string;
  runtimeState: Record<string, unknown>;
  domainData: Record<string, unknown>;
  history: BuilderSnapshot[];
}

export interface BuilderParseIssueSuggestion {
  kind: 'replace-text';
  from: string;
  to: string;
}

export interface BuilderUndefinedStateReferenceIssueContext {
  exampleInitializer?: string;
  refName: string;
}

export interface BuilderStalePersistedQueryIssueContext {
  statementId: string;
  suggestedQueryRefs: string[];
}

export interface BuilderOptionsShapeIssueContext {
  groupId: string;
  invalidValues: Array<number | string>;
}

export type BuilderParseIssueContext =
  | BuilderOptionsShapeIssueContext
  | BuilderStalePersistedQueryIssueContext
  | BuilderUndefinedStateReferenceIssueContext;

export interface BuilderParseIssue {
  code: string;
  context?: BuilderParseIssueContext;
  message: string;
  statementId?: string;
  suggestion?: BuilderParseIssueSuggestion;
  source?: 'mutation' | 'parser' | 'quality' | 'query' | 'runtime';
}

export type BuilderQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface BuilderQualityIssue extends BuilderParseIssue {
  severity: BuilderQualityIssueSeverity;
}

export interface BuilderLlmRequest {
  prompt: string;
  currentSource: string;
  chatHistory: BuilderLlmChatMessage[];
  invalidDraft?: string;
  mode: BuilderLlmRequestMode;
  parentRequestId?: BuilderRequestId;
  repairAttemptNumber?: number;
  validationIssues?: BuilderParseIssue[];
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

export interface BuilderGeneratedDraft
  extends Pick<BuilderLlmResponse, 'compaction' | 'qualityIssues' | 'source' | 'summary' | 'summaryExcludeFromLlmContext'> {
  commitSource: BuilderCommitSource;
  requestId: BuilderRequestId;
}

export interface BuilderConfigResponse {
  generation: {
    repairTemperature: number;
    temperature: number;
  };
  limits: {
    chatHistoryMaxItems: number;
    promptMaxChars: number;
    requestMaxBytes: number;
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

export interface PromptInfoToolSpec {
  description: string;
  name: string;
  signature: string;
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
  toolSpecs: PromptInfoToolSpec[];
  requestPromptTemplate: string;
}

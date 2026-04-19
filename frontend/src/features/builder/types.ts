export type BuilderConnectionStatus = 'loading' | 'connected' | 'disconnected';
export type BuilderTabId = 'preview' | 'definition' | 'app-state';
type BuilderMessageRole = 'assistant' | 'system' | 'user';
type BuilderMessageTone = 'default' | 'error' | 'info' | 'success';

export interface BuilderChatMessage {
  id: string;
  role: BuilderMessageRole;
  content: string;
  createdAt: string;
  tone?: BuilderMessageTone;
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

export interface BuilderParseIssue {
  code: string;
  message: string;
  statementId?: string;
  source?: string;
}

export interface BuilderLlmRequest {
  prompt: string;
  currentSource: string;
  chatHistory: Array<Pick<BuilderChatMessage, 'content' | 'role'>>;
}

export interface BuilderLlmRequestCompaction {
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

export interface BuilderLlmResponse {
  compaction?: BuilderLlmRequestCompaction;
  model: string;
  source: string;
}

export interface BuilderConfigResponse {
  limits: {
    chatHistoryMaxItems: number;
    promptMaxChars: number;
    requestMaxBytes: number;
  };
}

export interface HealthResponse {
  model: string;
  openaiConfigured: boolean;
  status: 'ok';
  timestamp: string;
}

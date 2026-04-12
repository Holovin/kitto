export type BuilderConnectionStatus = 'loading' | 'connected' | 'disconnected';
export type BuilderTabId = 'preview' | 'definition';
export type BuilderMessageRole = 'assistant' | 'system' | 'user';
export type BuilderMessageTone = 'default' | 'error' | 'info' | 'success';

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

export interface BuilderDemoSelection {
  id: string;
  label: string;
}

export interface BuilderLlmResponse {
  model: string;
  source: string;
}

export interface HealthResponse {
  model: string;
  status: 'ok';
  timestamp: string;
}

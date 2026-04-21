export type PromptBuildChatHistoryRole = 'assistant' | 'system' | 'user';
export type PromptConversationChatHistoryRole = Exclude<PromptBuildChatHistoryRole, 'system'>;
export type PromptBuildValidationIssueSource = 'mutation' | 'parser' | 'quality' | 'query' | 'runtime';

export interface PromptBuildValidationIssueSuggestion {
  kind: 'replace-text';
  from: string;
  to: string;
}

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
  message: string;
  source?: PromptBuildValidationIssueSource;
  statementId?: string;
  suggestion?: PromptBuildValidationIssueSuggestion;
}

export interface PromptBuildRequest {
  chatHistory: RawPromptBuildChatHistoryMessage[];
  currentSource: string;
  invalidDraft?: string;
  mode: 'initial' | 'repair';
  parentRequestId?: string;
  prompt: string;
  repairAttemptNumber?: number;
  validationIssues?: PromptBuildValidationIssue[];
}

export function getPromptBuildValidationIssueCodes(validationIssues?: PromptBuildValidationIssue[]) {
  const codes = (validationIssues ?? [])
    .map((issue) => (typeof issue.code === 'string' ? issue.code.trim() : ''))
    .filter((code): code is string => code.length > 0);

  return codes.length > 0 ? [...new Set(codes)] : [];
}

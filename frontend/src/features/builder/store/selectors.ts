import type { RootState } from '@store/store';

export const selectActiveTab = (state: RootState) => state.builder.activeTab;
export const selectChatMessages = (state: RootState) => state.builder.chatMessages;
export const selectCommittedSource = (state: RootState) => state.builder.committedSource;
export const selectDomainData = (state: RootState) => state.domain.data;
export const selectDraftPrompt = (state: RootState) => state.builder.draftPrompt;
export const selectHistory = (state: RootState) => state.builder.history;
export const selectDefinitionWarnings = (state: RootState) =>
  state.builder.isStreaming || selectHasRejectedDefinition(state) ? [] : state.builder.definitionWarnings;
export const selectIsStreaming = (state: RootState) => state.builder.isStreaming;
export const selectLastStreamChunkAt = (state: RootState) => state.builder.lastStreamChunkAt;
export const selectParseIssues = (state: RootState) => state.builder.parseIssues;
export const selectRedoHistory = (state: RootState) => state.builder.redoHistory;
export const selectRetryPrompt = (state: RootState) => state.builder.retryPrompt;
export const selectRuntimeSessionState = (state: RootState) => state.builderSession.runtimeSessionState;
export const selectStreamedSource = (state: RootState) => state.builder.streamedSource;
export const selectHasRejectedDefinition = (state: RootState) =>
  !state.builder.isStreaming &&
  state.builder.streamedSource !== state.builder.committedSource &&
  state.builder.parseIssues.length > 0;
export const selectPreviewSource = (state: RootState) => state.builder.committedSource;
export const selectDefinitionSource = (state: RootState) =>
  state.builder.isStreaming || selectHasRejectedDefinition(state) ? state.builder.streamedSource : state.builder.committedSource;
